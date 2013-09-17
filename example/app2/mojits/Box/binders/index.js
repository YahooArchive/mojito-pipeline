YUI.add('BoxIndexBinder', function (Y, NAME) {
	'use strict';
    Y.namespace('mojito.binders')[NAME] = {
        init: function (mojitProxy) {

            console.log(mojitProxy.data.get('sectionName') + ' displayed.');
        }
    };

});
