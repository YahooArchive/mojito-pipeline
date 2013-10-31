/*
 * Copyright (c) 2013, Yahoo! Inc. All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */

/*jslint browser: true, indent: 4, plusplus: true, nomen: true */
/*global unescape */

/**
 * The client-side piece of the pipeline that handles the end of the processing
 * of the tasks that are shipped to the client.
 */

var pipeline = (function () {
    'use strict';

    var events = new window.Pipeline.Events();

    /**
     * @class PipelineTask
     * @constructor
     * @param {Object} config Contains the following properties:
     *      - id
     *      - markup
     *      - embeddedChildren
     *      - displayTargets
     */
    function PipelineTask(config) {
        var p;

        for (p in config) {
            if (config.hasOwnProperty(p)) {
                this[p] = config[p];
            }
        }
    }

    PipelineTask.prototype = {

        /**
         * Test whether the section corresponding to this task is in the DOM.
         *
         * @method displayTest
         * @return {Boolean}
         */
        displayTest: function () {
            return !!document.getElementById(this.id + '-section');
        },

        /**
         * Fires the beforeDisplay event, injects the markup for this task into
         * the DOM and fires the afterDisplay event.
         *
         * @method display
         * @param {Function} callback Function invoked after the element has
         *      been displayed (but before the afterDisplay event is fired)
         */
        display: function (callback) {
            var self = this,
                stub = document.getElementById(this.id + '-section');

            events.fire(this.id, 'beforeDisplay', function () {
                var i, n, child, script,
                    displayedNodes = [],
                    replaceScripts = function (node) {
                        var i,
                            child,
                            script;

                        if (node.tagName === 'SCRIPT') {
                            script = document.createElement('script');
                            script.text = node.text;
                            node.parentNode.replaceChild(script, node);
                            return;
                        }

                        for (i = 0; i < node.children.length; i++) {
                            child = node.children[i];
                            replaceScripts(child);
                        }
                    };

                n = document.createElement('div');
                n.innerHTML = self.markup;

                while (n.children.length > 0) {
                    // Insert content just before the stub inside the parent node

                    // e.g.:
                    // <div id="parent">
                    //  <!-- the content will be inserted here -->
                    //  <div id="blahblah-section"></div> <!-- this is the stub -->
                    //  <span> some normal content</span>
                    //  <!-- this is where stub.parentNode.appendChild would insert the node, which is incorrect -->
                    // </div>
                    child = n.children[0];
                    stub.parentNode.insertBefore(child, stub);

                    // Replace any scripts with a newly created element using document.creteElement.
                    // This ensures that the script is executed.
                    // In IE the created script gets executed immediately after creation so the script must be
                    // replaced after any markup has been inserted onto the page, in case the script refers to
                    // the markup.
                    replaceScripts(child);

                    displayedNodes.push(child);
                }

                self.displayed = true;

                events.fire(self.id, 'afterDisplay', null, displayedNodes);

                for (i = 0; i < self.embeddedChildren.length; i++) {
                    child = self.embeddedChildren[i];
                    events.fire(child, 'afterDisplay');
                }

                if (callback) {
                    callback();
                }
            });
        }
    };

    return {

        tasks: {},

        events: events,

        /**
         * Pushes a new task into the pipeline, making it visible to the user
         * once all the dependencies, if any, are resolved...
         *
         * @method push
         * @param {Object} taskConfig Contains the following properties:
         *      - id
         *      - markup
         *      - embeddedChildren
         *      - displayTargets
         */
        push: function (taskConfig) {
            var pipeline = this,
                task = new PipelineTask(taskConfig),
                subscription;

            // TODO: fire an 'onPush' event
            this.tasks[taskConfig.id] = task;

            task.pushed = true;

            // Merge default displayTest with user provided test
            if (taskConfig.displayTest) {
                task.displayTest = function () {
                    return PipelineTask.prototype.displayTest.call(task) &&
                        taskConfig.displayTest(pipeline);
                };
            }

            // TODO: add the 'onPush' event in the targets to handle error and timedOut states from the server
            if (task.displayTest()) {
                task.display();
            } else {
                subscription = events.subscribe(task.displayTargets, function (event, callback) {
                    if (task.displayTest(task)) {
                        subscription.unsubscribe();
                        task.display(callback);
                    } else {
                        callback();
                    }
                });
            }
        },

        close: function () {
            var self = this;
            events.fire('pipeline', 'onClose', function () {
                var id,
                    task;
                if (typeof console !== 'undefined' && typeof console.error === 'function') {
                    for (id in self.tasks) {
                        if (self.tasks.hasOwnProperty(id)) {
                            task = self.tasks[id];
                            if (task.pushed && !task.displayed) {
                                console.error(task.id + ' remained undisplayed. ' +
                                    'Make sure that its display dependencies are satisfied ' +
                                    'and that a stub exists for it to be displayed.');
                            }
                        }
                    }
                }
            });
        },

        _getTask: function (id) {
            return this.tasks[id] || {
                id: id
            };
        }
    };

}());
