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
                searchResultsDependencies = [];

            // push search-results children
            for (i = 1; i <= 6; i++) {
                id = 'search-result' + i;
                searchResultsDependencies.push(id);
                ac.pipeline.push({
                    id: id,
                    group: 'results',
                    type: 'Box',
                    config: {
                        title: id,
                        taskType: 'dependency'
                    }
                });
            }

            // push sections
            Y.Object.each(ac.pipeline.data.sections, function (section) {
                if (section.sectionName === 'root' || section.sectionName === 'search-box' || section.sectionName === 'footer') {
                    return;
                }
                ac.pipeline.push({
                    id: section.sectionName,
                    type: section.type,
                    dependencies: section.sectionName === 'search-results' ? searchResultsDependencies : [],
                    config: {
                        title: section.sectionName,
                        taskType: section['default'] ? 'default section' : 'section'
                    }
                });
            });

            ac.pipeline.close();

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
