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
                var i = 0, n, child, script;

                n = document.createElement('div');
                n.innerHTML = unescape(self.markup);

                while (i < n.children.length) {
                    // insert content just before the stub inside the parent node
                    // e.g.:
                    // <div id="parent">
                    //  <!-- the content will be inserted here -->
                    //  <div id="blahblah-section"></div> <!-- this is the stub -->
                    //  <span> some normal content</span>
                    //  <!-- this is where stub.parentNode.appendChild would insert the node, which is incorrect -->
                    // </div>
                    if (n.children[0].tagName === 'SCRIPT') {
                        // If the child is a script, it must first be created using createElement,
                        // in order to ensure that the script is executed.
                        script = document.createElement('script');
                        script.innerHTML = n.children[i].innerHTML;
                        stub.parentNode.insertBefore(script, stub);
                        i++;
                    } else {
                        stub.parentNode.insertBefore(n.children[i], stub);
                    }

                }

                self.displayed = true;

                if (callback) {
                    callback();
                }

                events.fire(self.id, 'afterDisplay');

                for (i = 0; i < self.embeddedChildren.length; i++) {
                    child = self.embeddedChildren[i];
                    events.fire(child, 'afterDisplay');
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

        _getTask: function (id) {
            return this.tasks[id] || {
                id: id
            };
        }
    };

}());
