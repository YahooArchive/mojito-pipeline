/*jslint browser: true, indent: 4, plusplus: true */
/*global unescape */

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
                var i, n;

                n = document.createElement('div');
                n.innerHTML = unescape(self.markup);

                for (i = 0; i < n.children.length; i++) {
                    // TODO: Justify why we're doing insertBefore instead of appendChild...
                    stub.parentNode.insertBefore(n.children[i], stub);
                }

                self.displayed = true;

                if (callback) {
                    callback();
                }

                events.fire(self.id, 'afterDisplay');

                self.embeddedChildren.forEach(function (value) {
                    events.fire(value, 'afterDisplay');
                });
            });
        }
    };

    return {

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

            // Merge default displayTest with user provided test
            if (taskConfig.displayTest) {
                task.displayTest = function () {
                    return PipelineTask.prototype.displayTest.call(task) &&
                        taskConfig.displayTest(pipeline);
                };
            }

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
        }
    };

}());