/*jslint nomen: true, plusplus: true */
YUI.add('MasterController', function (Y, NAME) {
    'use strict';

    var RUNTIME_TASKS = [{
            id: 'search-result1',
            type: 'Box',
            config: {
                title: 'search-result1'
            }
        }, {
            id: 'search-result2',
            type: 'Box',
            config: {
                title: 'search-result2'
            }
        }, {
            id: 'search-result3',
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

            RUNTIME_TASKS.forEach(function (runtimeTaskConfig) {
                ac.pipeline.push(runtimeTaskConfig);
            });

            ac.pipeline.close();

            ac.pipeline.done(ac.params.body('children'));
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
