YUI.add('ErrorController', function (Y, NAME) {
	'use strict';

	Y.namespace('mojito.controllers')[NAME] = {
		index: function (ac) {
			ac.done({
				errorTitle: ac.config.get('errorTitle')
			});
		}
	};
}, '0.0.1', {
	requires: [
		'mojito-config-addon',
		'mojito-params-addon'
	]
});