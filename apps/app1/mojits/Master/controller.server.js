YUI.add('MasterController', function (Y, NAME) {
    Y.mojito.controllers[NAME] = {
        index: function (ac) {
            ac.done();
        }
    }
}, '0.0.1', {
    requires: [
        'mojito-pipeline-addon'
    ]
});
