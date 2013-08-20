/*jslint plusplus: true, forin: true */
YUI.add('target-action-events', function (Y) {
    'use strict';

    var Events = function (emitter) {
            this.emmitter = emitter;
            this.events = {};
        },
        justCallback = function (event, done) {
            return done();
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
                i = 0,
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
                while (i < subscribedActions.length) {
                    if (subscribedActions[i].unsubscribed) {
                        // neutralized unsubscribed action but still execute the callback to fire
                        subscribedActions[i] = justCallback;
                    }
                    subscribedActions[i++].apply(this, actionArguments);
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
                subscribedActions,
                subscription = new Events.Subscription(targets, subscribedAction);

            for (target in targets) {
                this.events[target] = this.events[target] || {};
                for (i = 0; i < targets[target].length; i++) {
                    targetAction = targets[target][i];
                    this.events[target][targetAction] = this.events[target][targetAction] || [];
                    this.events[target][targetAction].push(subscribedAction);
                }
            }

            return subscription;
        },

        once: function (targets, subscribedAction) {
            var subscription = this.subscribe(targets, function () {
                subscribedAction.apply(this, arguments);
                subscription.unsubscribe();
            });
        }
    };

    Events.mergeTargets = function () {
        var i,
            j,
            targets,
            target,
            targetAction,
            mergedTargets = {};

        for (i = 0; i < arguments.length; i++) {
            targets = arguments[i];
            for (target in targets) {
                mergedTargets[target] = mergedTargets[target] || [];
                for (j = 0; j < targets[target].length; j++) {
                    targetAction = targets[target][j];
                    if (mergedTargets[target].indexOf(targetAction) === -1) {
                        mergedTargets[target].push(targetAction);
                    }
                }
            }
        }
        return mergedTargets;
    };

    Events.Subscription = function (targets, subscribedAction) {
        this.targets = targets;
        this.subscribedAction = subscribedAction;
    };

    Events.Subscription.prototype = {
        /* Marks the susbscribed action as unsubscribed so that it can be removed
         */
        unsubscribe: function () {
            this.subscribedAction.unsubscribed = true;
            // Removing the subscribed action can cause issues if event actions are being called and
            // the array size changes in the middle, so we instead mark as unsubscribed
        }
    };

    Y.namespace('Pipeline').Events = Events;
}, '0.0.1', {
    requires: [
    ]
});
