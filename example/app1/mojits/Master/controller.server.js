/*jslint nomen: true, plusplus: true */
YUI.add('MasterController', function (Y, NAME) {
    'use strict';
    Y.namespace('mojito.controllers')[NAME] = {
        index: function (ac) {
            //ac.assets.addCss('/static/app/assets/base.css');
            //ac.assets.addCss('./master.css');

            var i,
                id,
                children,
                pushedTasks = 0,
                searchResultsChildren = {},
                closePipeline = function () {
                    if (--pushedTasks === 0) {
                        ac.pipeline.close();
                    }
                },
                randomPush = function (task) {
                    pushedTasks++;

                    setTimeout(function () {
                        ac.pipeline.push(task);
                        closePipeline();
                    }, 2000 * Math.random());
                };

            // push search-results
            for (i = 1; i <= 6; i++) {
                id = 'search-result' + i;
                searchResultsChildren[id] = {
                    id: id,
                    group: 'results',
                    type: 'Box',
                    // display search results in order.
                    display: i > 1 ? 'search-result' + (i - 1) + '.displayed' : undefined,
                    // prevent search results from being embedded in search-results collection
                    render: 'search-results.rendered',
                    config: {
                        title: 'search-result' + i,
                        cssClass: 'section'
                    }
                };
                randomPush(searchResultsChildren[id]);
            }

            // push sections
            Y.Object.each(ac.pipeline.specs, function (specs, id) {
                if (id === 'root' || specs.autoPush) {
                    return;
                }

                pushedTasks++;
                var task = specs;
                if (id === "search-results") {
                    task.children = searchResultsChildren;
                }
                task.config = Y.mix(task.config || {}, {
                    title: id,
                    cssClass: specs.blockParent ? 'dependency' : 'section'
                });

                setTimeout(function () {
                    ac.pipeline.push(task);
                    closePipeline();
                }, 200 * Math.random());
            });

            children = ac.params.body('children');

            ac.done(children);
        }
    };
}, '0.0.1', {
    requires: [
        'target-action-events',
        'mojito-pipeline-addon',
        'mojito-assets-addon',
        'mojito-params-addon'
    ]
});
