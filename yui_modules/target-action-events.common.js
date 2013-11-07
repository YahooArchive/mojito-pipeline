/*
 * Copyright (c) 2013, Yahoo! Inc. All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */
/*jslint indent: 4, plusplus: true */
/*global YUI, window */

/**
 * An implementation of a publish-subscribe model that lets the subscriber
 * choose multiple publishers and multiple events at a time.
 */

(function () {
    'use strict';

    function ASYNC_NOOP(event, callback) {
        callback();
    }

    /**
     * @class PipelineEvents
     * @constructor
     */
    function PipelineEvents() {
        this.events = {};
    }

    PipelineEvents.prototype = {

        /**
         * Invokes the subscribers that are interested in the specified action
         * on the given target.
         *
         * @method fire
         * @param {String} target The task that generated this event (e.g., "searchbox")
         * @param {String} action The action that is being reported (e.g., "beforeFlush")
         * @param {Function} callback A function which accepts as single
         *      parameter the number of subscribers that have been invoked
         *      as a result of this event being fired...
         */
        fire: function (target, action, callback) {
            var self = this,
                subscriber,
                subscribers,
                subscribersCount,
                subscribersInvoked,
                evt,
                fn,
                args,
                optionalArgs,
                i;

            subscribers = this.events[target] && this.events[target][action];

            if (!subscribers && target === '*') {
                return callback && callback(0);
            }

            optionalArgs = Array.prototype.slice.call(arguments, 0).slice(3);

            if (!subscribers) {
                return this.fire.apply(this, [
                    '*',
                    action,
                    callback
                ].concat(optionalArgs));
            }

            subscribersInvoked = 0;
            subscribersCount = subscribers.length;

            // The event object passed to the subscribers.
            evt = {
                target: target,
                action: action
            };

            // Subscribers can be asynchronous! Once they are done executing,
            // they have to call a function which is passed as their second
            // argument. This function checks whether all the subscribers have
            // been invoked. If so, it invokes the callback passed to the
            // 'fire' method...
            fn = function () {
                if (++subscribersInvoked === subscribersCount) {
                    if (target === '*') {
                        return callback && callback(subscribersInvoked);
                    }
                    self.fire.apply(self, [
                        '*',
                        action,
                        function (wildcardSubscribers) {
                            return callback && callback(subscribersInvoked + wildcardSubscribers);
                        }
                    ].concat(optionalArgs));
                }
            };

            // The arguments passed to a subscriber.
            args = [evt, fn].concat(optionalArgs);

            for (i = 0; i < subscribersCount; i++) {
                subscriber = subscribers[i];

                if (subscriber.unsubscribed) {
                    // This subscriber is not interested in subscribing to that
                    // event, so we replace it with a 'noop' function...
                    subscriber = ASYNC_NOOP;
                }

                subscriber.apply(this, args);
            }
        },

        /**
         * Subscribes to a list of actions on multiple targets.
         *
         * @method subscribe
         * @param {Object} targets The targets and the corresponding actions
         *      on those targets we want to subscribe to, e.g.
         *          {
         *              "searchbox": ["beforeRender", "afterFlush"],
         *              "footer": ["beforeDisplay"]
         *          }
         * @param {Function} fn callback function with the following parameters:
         *          - event: an object containg the following properties:
         *              - target (e.g., "searchbox")
         *              - action (e.g., "beforeRender")
         *          - callback: a function which must be invoked once the subscriber
         *              has finished executing. This allows a subscriber to be either
         *              synchronous or asynchronous while guaranteeing that we can
         *              resume processing once ALL the subscribers have been invoked.
         * @return {PipelineEvents.Subscription} a subscription object
         */
        subscribe: function (targets, fn) {
            var target,
                actions,
                action,
                subscribers,
                i;

            for (target in targets) {
                if (targets.hasOwnProperty(target)) {

                    if (!this.events[target]) {
                        this.events[target] = {};
                    }

                    actions = targets[target];

                    for (i = 0; i < actions.length; i++) {
                        action = actions[i];

                        if (!this.events[target][action]) {
                            this.events[target][action] = [];
                        }

                        subscribers = this.events[target][action];
                        subscribers.push(fn);
                    }
                }
            }

            return new PipelineEvents.Subscription(fn);
        },

        /**
         * Subscribes to a list of actions on multiple targets. The supplied
         * callback will only be executed once, even though we might have
         * subscribed to multiple targets and actions...
         *
         * @method once
         * @return {PipelineEvents.Subscription} a subscription object
         */
        once: function (targets, fn) {
            var subscription = this.subscribe(targets, function () {
                fn.apply(this, arguments);
                subscription.unsubscribe();
            });

            return subscription;
        }
    };

    /**
     * @class PipelineEvents.Subscription
     * @constructor
     */
    PipelineEvents.Subscription = function (fn) {
        this.fn = fn;
    };

    PipelineEvents.Subscription.prototype = {

        /**
         * Prevents a subscriber function from being called more than once.
         * @method unsubscribe
         * @see PipelineEvents::subscribe
         */
        unsubscribe: function () {
            // Removing the subscribed action can cause issues if event actions
            // are being called and the array size changes in the middle, so we
            // instead mark as unsubscribed.
            this.fn.unsubscribed = true;
        }
    };

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
