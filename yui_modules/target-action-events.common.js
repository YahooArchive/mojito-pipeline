/*jslint indent: 4, plusplus: true */
/*global YUI, window */

(function () {
    'use strict';

    var Events = function (emitter) {
            this.emmitter = emitter;
            this.events = {};
        },
        justCallback = function (event, done) {
            return done();
        };

    Events.prototype = {

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

        subscribe: function (targets, subscribedAction) {
            var i, target, targetAction;

            for (target in targets) {
                if (targets.hasOwnProperty(target)) {
                    this.events[target] = this.events[target] || {};
                    for (i = 0; i < targets[target].length; i++) {
                        targetAction = targets[target][i];
                        this.events[target][targetAction] = this.events[target][targetAction] || [];
                        this.events[target][targetAction].push(subscribedAction);
                    }
                }
            }

            return new Events.Subscription(targets, subscribedAction);
        },

        once: function (targets, subscribedAction) {
            var subscription = this.subscribe(targets, function () {
                subscribedAction.apply(this, arguments);
                subscription.unsubscribe();
            });
        }
    };

    // This is only used on the server - TODO: move me!
    Events.mergeTargets = function () {
        var i, j, targets, target, targetAction, mergedTargets = {};

        for (i = 0; i < arguments.length; i++) {
            targets = arguments[i];
            for (target in targets) {
                if (targets.hasOwnProperty(target)) {
                    mergedTargets[target] = mergedTargets[target] || [];
                    for (j = 0; j < targets[target].length; j++) {
                        targetAction = targets[target][j];
                        if (mergedTargets[target].indexOf(targetAction) === -1) {
                            mergedTargets[target].push(targetAction);
                        }
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

        unsubscribe: function () {
            this.subscribedAction.unsubscribed = true;
            // Removing the subscribed action can cause issues if event actions
            // are being called and the array size changes in the middle, so we
            // instead mark as unsubscribed
        }
    };

    // Make this library available either as a YUI module, if YUI is defined,
    // which is the case on the server, or as an object attached to the window
    // object on the client side.

    if (typeof YUI !== 'undefined') {

        YUI.add('target-action-events', function (Y) {
            Y.namespace('Pipeline').Events = Events;
        });

    } else if (typeof window !== 'undefined') {

        if (!window.Pipeline) {
            window.Pipeline = {};
        }

        window.Pipeline.Events = Events;
    }

}());
