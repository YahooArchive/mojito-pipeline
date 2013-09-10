YUI.add('BoxIndexBinder', function (Y, NAME) {
	'use strict';
    Y.namespace('mojito.binders')[NAME] = {
        init: function (mojitProxy) {
            var sectionName = mojitProxy.data.get('sectionName'),
                sectionType = mojitProxy.data.get('sectionType');

            console.log(sectionName + ' (' + sectionType + ') displayed.');
        }
    };

}, '0.0.1', {
    requires: [
    ]
});
