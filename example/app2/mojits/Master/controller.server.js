/*jslint nomen: true, plusplus: true */
YUI.add('MasterController', function (Y, NAME) {
    'use strict';


    var RUNTIME_TASKS = [{
            id: 'search-result1',
            // group: 'results',
            type: 'Box',
            config: {
                title: 'search-result1'
            }
        }, {
            id: 'search-result2',
            // group: 'results',
            type: 'Box',
            config: {
                title: 'search-result2'
            }
        }, {
            id: 'search-result3',
            // group: 'results',
            type: 'Box',
            config: {
                title: 'search-result3'
            }
        }, {
            id: 'search-results',
            dependencies: [
                'search-result1',
                'search-result2',
                'search-result3'
            ],
            config: {
                title: 'Results'
            }
        }, {
            id: 'ads',
            config: {
                title: 'Ads'
            }
        }, {
            id: 'north-ad',
            config: {
                title: 'Macy\'s great deals!!'
            }
        }, {
            id: 'south-ad',
            config: {
                title: 'Shop in our store'
            }
        }];

    Y.namespace('mojito.controllers')[NAME] = {

        index: function (ac) {
            var view = {},
                i;

            for (i = 0; i < RUNTIME_TASKS.length; i++) {
                ac.pipeline.push(RUNTIME_TASKS[i]);
            }

            ac.pipeline.close();

            Y.mix(view, ac.params.body('children'));

            ac.pipeline.done(view);
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
