var EXPORTED_SYMBOLS = ["Presence", "PresenceProfiles", "PresenceProfile"];

ML.importMod("roles.js");
ML.importMod("utils.js");
ML.importMod("modeltypes.js");
ML.importMod("prefs.js");
//ML.importMod("l10n.js");

function Presence(show, status, priority, profile, last)
{
    if (show instanceof JSJaCPresence) {
        var pkt = show, type = show.getType();
        if (this._showValues[type] === 0)
            this.show = type;
        else
            this.show = pkt.getShow();

        if (!this.show || !(this.show in this._showValues))
            this.show = "available";
        this.status = pkt.getStatus()
        this.priority = pkt.getPriority() || 0;

        last = pkt.getChild("query", "jabber:iq:last");
        if (last)
            this.last = +last.getAttribute("seconds");

        var stamp = pkt.getChild("delay", "urn:xmpp:delay")
        if (stamp)
            this.stamp = iso8601TimestampToDate(stamp.getAttribute("stamp"));
    } else {
        this.show = show;
        if (!this.show || !(this.show in this._showValues))
            this.show = "available";

        this.status = status;
        this.priority = priority == null || isNaN(+priority) ?
            parseInt(this._priorityMap[this.show]*prefManager.getPref("chat.connection.priority")) :
            +priority;
        this.last = last;
    }

    this.profile = profile;
}

_DECL_(Presence, null, Comparator).prototype =
{
    _showValues: {
        available: 5,
        chat: 4,
        dnd: 3,
        away: 2,
        xa: 1,
        unavailable: 0,
        invisible: 0,
        subscribe: 0,
        subscribed: 0,
        unsubscribe: 0,
        unsubscribed: 0
    },

    _subscriptions: {
        subscribe: 0,
        subscribed: 0,
        unsubscribe: 0,
        unsubscribed: 0
    },

    generatePacket: function(contact)
    {
        var pkt = new JSJaCPresence();
        if (contact)
            pkt.setTo(contact.jid || contact);

        var presence = (this.profile && contact &&
                        this.profile.getPresenceFor(contact)) || this;

        if (this._showValues[presence.show] === 0)
            pkt.setType(presence.show);
        else {
            if (presence.show && presence.show != "available")
                pkt.setShow(presence.show);

            if (presence.priority)
                pkt.setPriority(presence.priority);

            if (account.avatarRetrieved) {
                pkt.appendNode("x", {xmlns: "vcard-temp:x:update"},
                                [["photo", {}, account.avatarHash || ""]]);
            }
            servicesManager.appendCapsToPresence(pkt.getNode());
        }

        if (presence.last)
            pkt.appendNode("query", {xmlns: "jabber:iq:last", seconds: presence.last});

        if (presence.status)
            pkt.setStatus(presence.status);

        return pkt;
    },

    equal: function(p)
    {
        return this.show == p.show && this.status == p.status &&
            this.priority == p.priority && this.profile == p.profile;
    },

    cmp: function(p, comparePriority)
    {
        const show2num = {chat: 0, available: 1, dnd: 2, away:3, xa: 4,
                          unavailable: 5};

        if (comparePriority)
            if (this.priority != p.priority)
                return p.priority - this.priority;

        return show2num[this.show||"available"] - show2num[p.show||"available"];
    },

    get isSubscription() {
        return this.show in this._subscriptions;
    },

    get showAsNumber() {
        return this._showValues[this.show] || 5;
    },

    _showToString: {
        available: _("Available"),
        chat: _("Available for chat"),
        dnd: _("Busy"),
        away: _("Away"),
        xa: _("Not available"),
        unavailable: _("Offline"),
        invisible: _("Invisible")
    },

    toString: function(showStatus, lowerCase)
    {
        var showStr = this._showToString[this.show];
        if (lowerCase)
            showStr = showStr.toLowerCase();

        return showStr+(showStatus && this.status ? " ("+this.status+")" : "");
    },

    getStyle: function(forNewMessage)
    {
        return account.style.getStatusStyle(this, forNewMessage);
    },

    getIcon: function(forNewMessage)
    {
        return account.style.getStatusIcon(this.show, forNewMessage);
    },

    get serialized() {
        return {
            show: this.show,
            status: this.status || "",
            priority: this.priority,
            showString: this.toString(),
            style: this.getStyle(),
            icon: makeDataUrlFromFile(this.getIcon())
        };
    },

    _priorityMap: {
        available: 5/5,
        chat: 5/5,
        dnd: 4/5,
        away: 3/5,
        xa: 2/5,
        unavailable: 0
    }
}

function PresenceProfiles()
{
    this.init();
}

_DECL_(PresenceProfiles, null, Model).prototype =
{
    profiles: [],

    /*<profiles>
       <profile name="match">
         <presence show="dnd" priority="4" status="dnd">
           <group>test</group>
           <jid>user@server</jid>
         </presence>
       </profile>
       <profile name="revmatch">
         <presence>
           <group>work</group>
         </presence>
         <presence show="dnd" priority="4" status="dnd" />
       </profile>
     </profiles> */

    loadFromServer: function(callback)
    {
        if (this.profiles.length) {
            var p = this.profiles;
            this.profiles = [];
            this.modelUpdated("profiles", {removed: p});
        }

        servicesManager.sendIq({
          type: "get",
          e4x: <query xmlns="jabber:iq:private">
                 <profiles xmlns="oneteam:presence-profiles"/>
               </query>
        }, new Callback(this._onPresenceProfiles, this).addArgs(callback).fromCall());
    },

    storeOnServer: function()
    {
        const ns = "oneteam:presence-profiles";
        var profiles = ["profiles", {xmlns: ns}, []];

        for (var i = 0; i < this.profiles.length; i++) {
            var profile = this.profiles[i];
            var tags = [];

            for (var j = 0; j < profile.presences.length; j++) {
                var presence = profile.presences[j];

                var attrs = {xmlns: ns};
                if (presence.presence)
                    for each (var attr in "show priority status".split(" "))
                        if (presence.presence[attr])
                            attrs[attr] = presence.presence[attr];

                var elts = [];
                for (k = 0; k < presence.groups.length; k++)
                    elts.push(["group", {xmlns: ns}, [presence.groups[k]]]);
                for (k = 0; k < presence.jids.length; k++)
                    elts.push(["jid", {xmlns: ns}, [presence.jids[k]]]);

                tags.push(["presence", attrs, elts]);
            }
            profiles[2].push(["profile", {xmlns: ns, name: profile.name}, tags]);
        }

        servicesManager.sendIq({
          type: "set",
          domBuilder: ["query", {xmlns: "jabber:iq:private"}, [profiles]]
        });
    },

    update: function(addedProfiles, removedProfiles)
    {
        var rp = [];
        for (var i = 0; i < removedProfiles.length; i++) {
            var idx = this.profiles.indexOf(removedProfiles[i]);
            if (idx >= 0) {
                this.profiles.splice(idx, 1);
                rp.push(removedProfiles[i]);
            }
        }
        this.profiles.push.apply(this.profiles, addedProfiles);
        this.storeOnServer();
        this.modelUpdated("profiles", {added: addedProfiles, removed: rp});
    },

    _onPresenceProfiles: function(callback, packet)
    {
        if (packet.getType() != "result")
            return;

        var profiles = [];
        var profileTags = packet.getNode().getElementsByTagName("profile");
        for (var i = 0; i < profileTags.length; i++) {
            var presences = [];
            var presenceTags = profileTags[i].getElementsByTagName("presence");
            for (j = 0; j < presenceTags.length; j++) {
                var presence = {};
                var [show, priority, status] = ["show", "priority", "status"].
                    map(function(v){return presenceTags[j].getAttribute(v)});

                if (show != null || priority != null || status != null)
                    presence.presence = new Presence(show, status, priority);

                presence.groups = Array.map(presenceTags[j].getElementsByTagName("group"),
                                            function(g){return g.textContent});
                presence.jids = Array.map(presenceTags[j].getElementsByTagName("jid"),
                                          function(g){return g.textContent});
                presences.push(presence);
            }
            profiles.push(new PresenceProfile(profileTags[i].getAttribute("name"),
                                              presences));
        }
        this.profiles = profiles;
        this.modelUpdated("profiles", {added: profiles});

        if (callback)
            callback();
    }
}

function PresenceProfile(name, presences)
{
    this.name = name;
    this.presences = presences;
    this._groupsHash = {};
    this._jidsHash = {};

    this._recalcHashes();
    this.init();
}

_DECL_(PresenceProfile, null, Model).prototype =
{
    _recalcHashes: function()
    {
        var matchRestRule = <list xmlns="jabber:iq:privacy"/>, matchRestKey = "";
        var matchRestId, matchRestIdx = 0;

        this._privacyRules = [];

        for (var i = 0; i < this.presences.length; i++) {
            var id, idx = 0, key = "", rule = <list xmlns="jabber:iq:privacy"/>;

            for (var j = 0; j < this.presences[i].groups.length; j++) {
                this._groupsHash[this.presences[i].groups[j]] = this.presences[i].presence;
                id = "g:"+this.presences[i].groups[j]+"\n";
                key += id;
                matchRestKey += id;

                rule.* += <item xmlns="jabber:iq:privacy" type="group" value={this.presences[i].groups[j]}
                              action="allow" order={++idx}>
                            <presence-out/>
                          </item>
                matchRestRule.* += <item xmlns="jabber:iq:privacy" type="group"
                                         value={this.presences[i].groups[j]}
                                         action="deny" order={++matchRestIdx}>
                                     <presence-out/>
                                   </item>
            }
            for (var j = 0; j < this.presences[i].jids.length; j++) {
                this._jidsHash[this.presences[i].jids[j]] = this.presences[i].presence;
                id = "j:"+this.presences[i].jids[j]+"\n";
                key += id;
                matchRestKey += id;

                rule.* += <item xmlns="jabber:iq:privacy" type="jid" value={this.presences[i].jids[j]}
                              action="allow" order={++idx}>
                            <presence-out/>
                          </item>
                matchRestRule.* += <item xmlns="jabber:iq:privacy" type="jid"
                                       value={this.presences[i].jids[j]}
                                       action="deny" order={++matchRestIdx}>
                                     <presence-out/>
                                   </item>
            }
            if (this.presences[i].groups.length == 0 &&
                this.presences[i].jids.length == 0)
            {
                this._matchRestPresence = this.presences[i].presence;
                matchRestId = i;
            } else {
                rule.@name = "ot-pr-"+hex_sha1(key);
                rule.* += <item xmlns="jabber:iq:privacy" action="deny" order={++idx}>
                            <presence-out/>
                          </item>;
                this._privacyRules[i] = rule;
            }

            if (!this.presences[i].presence)
                this._inheritedPresence = i;
        }

        if (this._inheritedPresence == null)
            this._inheritedPresence = i;

        matchRestRule.@name = "ot-pr-rev-"+hex_sha1(matchRestKey);
        this._privacyRules[matchRestId == null ? i : matchRestId] = matchRestRule;
    },

    activate: function()
    {
        for (i = 0; i < this._privacyRules.length; i++)
            if (!privacyService.lists[this._privacyRules[i].@name])
                privacyService.sendList(this._privacyRules[i]);

        for (i = 0; i < this._privacyRules.length; i++)
            if (i != this._inheritedPresence) {
                privacyService.activateList(this._privacyRules[i].@name);
                account.connection.send(this.presences[i].presence.generatePacket());
            }

        privacyService.activateList(this._privacyRules[this._inheritedPresence].@name);
    },

    update: function(newName, newPresences)
    {
        var flags = [];

        if (newName && newName != this.name) {
            this.name = newName;
            flags.push("name", null);
        }

        if (newPresences) {
            this.presences = newPresences;
            flags.push("presences", null);
            this._recalcHashes();
        }

        this.modelUpdated.apply(this, flags);
    },

    inheritsPresence: function(contact)
    {
        var jid, groups;

        if (!contact)
            return true;

        if (typeof(contact) == "string") {
            jid = contact;
            groups = [];
        } else if (contact instanceof JID) {
            jid = contact.normalizedJID;
            groups = [];
        } else {
            jid = contact.jid.normalizedJID;
            groups = contact.groups;
        }

        if (jid in this._jidsHash)
            return !this._jidsHash[jid];
        for (var i = 0; i < groups.length; i++)
            if (groups[i] in this._groupsHash)
                return !this._groupsHash[groups[i]];

        return true;
    },

    getPresenceFor: function(contact)
    {
        var jid, groups;

        if (!contact)
            return this._matchRestPresence;

        if (typeof(contact) == "string") {
            jid = contact;
            groups = [];
        } else if (contact instanceof JID) {
            jid = contact.normalizedJID;
            groups = [];
        } else {
            jid = contact.jid.normalizedJID;
            groups = contact.groups;
        }

        if (jid in this._jidsHash)
            return this._jidsHash[jid];
        for (var i = 0; i < groups.length; i++)
            if (groups[i] in this._groupsHash)
                return this._groupsHash[groups[i]];

        return this._matchRestPresence;
    },

    getNotificationSchemeFor: function(contact)
    {
    }
}
