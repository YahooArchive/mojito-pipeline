YUI.add('SearchResultsController', function (Y, NAME) {
    'use strict';

    Y.namespace('mojito.controllers')[NAME] = {
        index: function (ac) {
            var view = {
                    title: ac.config.get('title')
                };

            Y.mix(view, ac.params.body('children'));

            ac.done(view);
        }
    };

}, '0.0.1', {
    requires: [
        'mojito-config-addon',
        'mojito-params-addon'
    ]
});
