/*
 * Copyright (c) 2013 Yahoo! Inc. All rights reserved.
 */

YUI.add('mojito-pipeline-addon', function (Y, NAME) {
	'use strict';

	function PipelineAddon() {
		PipelineAddon.superclass.constructor.apply(this, arguments);
	}
	PipelineAddon.NS = 'pipeline';

	Y.extend(PipelineAddon, Y.Plugin.Base, {
		push: function (task) {

		}
	});

	Y.namespace('mojito.addons.ac');
	Y.mojito.addons.ac.pipeline = PipelineAddon;
}, '0.0.1', { requires: ['mojito-composite-addon']});
