/*jslint plusplus: true, forin: true */
YUI.add('target-action-events', function (Y) {
    'use strict';

    var Events = function (emitter) {
        this.emmitter = emitter;
        this.events = {};
    };

    Events.prototype = {
        /* Calls any subscribed actions to a target's action
         * @param {string} target The target.
         * @param {string} targetAction The target's action.
         * @param {string} done The callback called after all subscribed actions have been called.
         * @params optional arguments
         */
        fire: function (target, targetAction, done) {
            var subscribedActions = this.events[target] && this.events[target][targetAction],
                numSubscribedActions = subscribedActions && subscribedActions.length,
                i,
                eventsCompleted = 0,
                event = {
                    target: target,
                    targetAction: targetAction,
                    emitter: this.emitter
                },
                eventDone = function () {
                    if (done && ++eventsCompleted === numSubscribedActions) {
                        done(eventsCompleted);
                    }
                },
                actionArguments = [
                    event,
                    eventDone
                ];

            if (subscribedActions) {
                // add optional arguments to the arguments passed to the action
                Array.prototype.push.apply(actionArguments, Array.prototype.slice.call(arguments, 0).slice(3));
                for (i = 0; i < subscribedActions.length; i++) {
                    subscribedActions[i].apply(this, actionArguments);
                }
            } else if (done) {
                done(0);
            }
        },

        /* Sets an action subscribed to the targets specified
         * @param {object} targets The targets to listen to.
         * @param {function} subscribedActon The action that subscribes to the specified targets.
         * @return {Event.subscription} The subscription to the targets subscribed to. This object
         * can be used to unsubscribe from the targets.
         */
        subscribe: function (targets, subscribedAction) {
            var pipeline = this.pipeline,
                i,
                target,
                targetAction,
                subscription = new Events.Subscription(this.events, targets, subscribedAction);

            for (target in targets) {
                this.events[target] = this.events[target] || {};
                for (i = 0; i < targets[target].length; i++) {
                    targetAction = targets[target][i];
                    this.events[target][targetAction] = this.events[target][targetAction] || [];
                    this.events[target][targetAction].push(subscribedAction);
                }
            }

            return subscription;
        }
    };

    Events.Subscription = function (events, targets, subscribedAction) {
        this.events = events;
        this.targets = targets;
        this.subscribedAction = subscribedAction;
    };

    Events.Subscription.prototype = {
        /* Unsubscribes from all target actions in the subscription by removing
         * the subscribed action
         */
        unsubscribe: function () {
            var target,
                i,
                targetAction,
                subscribedActions,
                subscribedActionIndex;
            for (target in this.targets) {
                for (i = 0; i < this.targets[target].length; i++) {
                    targetAction = this.targets[target][i];
                    subscribedActions = this.events[target][targetAction];
                    subscribedActionIndex = subscribedActions.indexOf(this.subscribedAction);
                    if (subscribedActionIndex !== -1) {
                        subscribedActions.splice(subscribedActionIndex, 1);
                    }
                }
            }
        }
    };

    Y.namespace('Pipeline').Events = Events;
}, '0.0.1', {
    requires: [
    ]
});
