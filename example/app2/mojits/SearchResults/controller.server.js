YUI.add('SearchResultsController', function (Y, NAME) {
    'use strict';

    Y.namespace('mojito.controllers')[NAME] = {

        index: function (ac) {

            var view = {
                    title: ac.config.get('title'),
                    results: []
                };

            Y.mix(view, ac.params.body('children'));

            ['search-result1', 'search-result2', 'search-result3'].forEach(function (name) {

                view.results.push(ac.params.body('children')[name]);
            });

            ac.done(view);
        }
    };

}, '0.0.1', {
    requires: [
        'mojito-config-addon',
        'mojito-params-addon'
    ]
});
