/*jslint indent: 4, plusplus: true */
/*global YUI, window */

(function () {
    'use strict';

    //-- PipelineEvents -------------------------------------------------------

    function PipelineEvents() {
        this.events = {};
    }

    PipelineEvents.prototype = {

        /**
         * Invokes the subscribers that are interested in the specified action
         * on the given target.
         *
         * @param {String} target The task id of the target (e.g., "searchbox")
         *
         * @param {String} targetAction The action that is being reported (e.g., "beforeFlush")
         *
         * @param {Function} done A function which accepts as single parameter
         *      the number of subscribers that have been invoked.
         */
        fire: function (target, targetAction, done) {
            var subscribedActions = this.events[target] && this.events[target][targetAction],
                numSubscribedActions = subscribedActions && subscribedActions.length,
                i = 0,
                eventsCompleted = 0,
                event = {
                    target: target,
                    targetAction: targetAction
                },
                eventDone = function () {
                    if (done && ++eventsCompleted === numSubscribedActions) {
                        done(eventsCompleted);
                    }
                },
                actionArguments = [
                    event,
                    eventDone
                ],
                callback = function (event, done) {
                    return done();
                };

            if (subscribedActions) {
                // add optional arguments to the arguments passed to the action
                Array.prototype.push.apply(actionArguments, Array.prototype.slice.call(arguments, 0).slice(3));
                while (i < subscribedActions.length) {
                    if (subscribedActions[i].unsubscribed) {
                        // neutralized unsubscribed action but still execute the callback to fire
                        subscribedActions[i] = callback;
                    }
                    subscribedActions[i++].apply(this, actionArguments);
                }
            } else if (done) {
                done(0);
            }
        },

        /**
         * Subscribes to a list of actions on multiple targets.
         *
         * @param {Object} targets The targets and the corresponding actions
         *      on those targets we want to subscribe to, e.g.
         *          {
         *              "searchbox": ['beforeRender', 'afterFlush'],
         *              "footer": ['beforeDisplay']
         *          }
         *
         * @param {Function} subscribedAction a callback function which accepts
         *      the following parameters:
         *          - event: an object containg the following properties:
         *              - target (e.g., "searchbox")
         *              - targetAction (e.g., "beforeRender")
         *          - done: a calback which must be invoked once the subscriber
         *                  has finished executing. This allows a subscriber to
         *                  be either synchronous or asynchronous and guarantee
         *                  that subscribers are invoked in the right order.
         *
         * @return {PipelineEvents.Subscription} a subscription object
         */
        subscribe: function (targets, subscribedAction) {
            var i, target, targetAction;

            for (target in targets) {
                if (targets.hasOwnProperty(target)) {
                    if (!this.events[target]) {
                        this.events[target] = {};
                    }
                    for (i = 0; i < targets[target].length; i++) {
                        targetAction = targets[target][i];
                        if (!this.events[target][targetAction]) {
                            this.events[target][targetAction] = [];
                        }
                        this.events[target][targetAction].push(subscribedAction);
                    }
                }
            }

            return new PipelineEvents.Subscription(targets, subscribedAction);
        },

        once: function (targets, subscribedAction) {
            var subscription = this.subscribe(targets, function () {
                subscribedAction.apply(this, arguments);
                subscription.unsubscribe();
            });
        }
    };

    //-- PipelineEvents.Subscription ------------------------------------------

    PipelineEvents.Subscription = function (targets, subscribedAction) {
        this.targets = targets;
        this.subscribedAction = subscribedAction;
    };

    PipelineEvents.Subscription.prototype = {

        unsubscribe: function () {
            this.subscribedAction.unsubscribed = true;
            // Removing the subscribed action can cause issues if event actions
            // are being called and the array size changes in the middle, so we
            // instead mark as unsubscribed
        }
    };

    //-------------------------------------------------------------------------
    // Make this library available either as a YUI module, if YUI is defined,
    // which is the case on the server, or as an object attached to the window
    // object on the client side.

    if (typeof YUI !== 'undefined') {

        YUI.add('target-action-events', function (Y) {
            Y.namespace('Pipeline').Events = PipelineEvents;
        });

    } else if (typeof window !== 'undefined') {

        if (!window.Pipeline) {
            window.Pipeline = {};
        }

        window.Pipeline.Events = PipelineEvents;
    }

}());
