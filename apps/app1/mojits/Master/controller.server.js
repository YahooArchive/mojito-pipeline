/*jslint nomen: true, plusplus: true */
YUI.add('MasterController', function (Y, NAME) {
    'use strict';
    Y.namespace('mojito.controllers')[NAME] = {
        index: function (ac) {
            ac.assets.addCss('/static/app/assets/base.css');
            ac.assets.addCss('./master.css');

            var i,
                id,
                children,
                pushedTasks = 0,
                searchResultsDependencies = [],
                closePipeline = function () {
                    if (--pushedTasks === 0) {
                        ac.pipeline.close();
                    }
                };

            // push search-results children
            for (i = 1; i <= 6; i++) {
                searchResultsDependencies.push('search-result' + i);
                pushedTasks++;
                (function () {
                    var task = {
                        id: 'search-result' + i,
                        group: 'results',
                        type: 'Box',
                        config: {
                            title: 'search-result' + i,
                            taskType: 'dependency'
                        }
                    };
                    setTimeout(function () {
                        ac.pipeline.push(task);
                        closePipeline();
                    }, 2000 * Math.random());
                }());

            }

            // push sections
            Y.Object.each(ac.pipeline.data.sections, function (section) {
                if (section.sectionName === 'root' || section.sectionName === 'search-box' || section.sectionName === 'footer') {
                    return;
                }
                pushedTasks++;
                var task = {
                    id: section.id,
                    type: section.type,
                    dependencies: section.sectionName === 'search-results' ? searchResultsDependencies : [],
                    config: {
                        title: section.sectionName,
                        taskType: section['default'] ? 'default section' : 'section'
                    }
                };
                setTimeout(function () {
                    ac.pipeline.push(task);
                    closePipeline();
                }, 4000 * Math.random());
            });

            children = ac.params.body('children');

            if (ac.pipeline.client.jsEnabled) {
                ac.done(children);
            } else {
                ac.pipeline.on('close', function () {
                    ac.done(children);
                });
            }
        }
    };
}, '0.0.1', {
    requires: [
        'mojito-pipeline-addon',
        'mojito-assets-addon',
        'mojito-params-addon'
    ]
});
