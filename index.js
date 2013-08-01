/*
 * Copyright (c) 2013 Yahoo! Inc. All rights reserved.
 */

YUI.add('mojito-pipeline-addon', function (Y, NAME) {
	'use strict';

	/**
	 * The main task processor - takes care of the lifecycle
	 * of the tasks
	 * @param {Object} command the command from the action context
	 * @param {Object} adapter the output adapter for flushing the rendered views
	 * @param {ActionContext} ac the action context for the current request
	 */

	function Pipeline(command, adapter, ac) {
		Pipeline.superclass.constructor.apply(this, {
			command: command,
			adapter: adapter,
			ac: ac
		});
		this.Task.prototype.pipeline = this;

		this.on('rendered', dispatchRender);
	}

	Y.extend(Pipeline, Y.Base, {
		namespace: 'pipeline',
		initializer: function (config) {
			this.sections = config.sections;
			this.rules = {};
			this._resolveRules();
			this._flushQueue = [];
		}
	});
	Pipeline.prototype._resolveRules = function() {
		// this.rules = ...
	};
	Pipeline.prototype.render = function(task) {
	};
	Pipeline.prototype.flushQueue = function() {
	};
	Pipeline.prototype.getTask = function(id) {
	};
	Pipeline.prototype.push = function(task) {
		var nextChild,
			childrenTest = function () {
				var child,
					test = true;
				for (child in task.children) {
					test = test & pipeline.getTask(nextChild).rendered;
				}
			},
			combinedTest = pipeline.combineTests(task.renderTest, childrenTest),
			renderAction = function () {
				if (combinedTest()) {
					pipeline.render(task);
				}
			};

		for (nextChild in task.children) {
			this.rules[nextChild] = this.rules[nextChild] || {};
			this.rules[nextChild].render = this.rules[nextChild].render || [];
			task.renderTest = pipeline._combineTests(task.renderTest, );
			this.rules[nextChild].render.push();
		}
	};
	Pipeline.prototype.close = function() {
	};
	Pipeline.prototype.setRule = function(subscriptor, method, config) {
	};
	Pipeline.prototype._combineTests = function (test1, test2) {
		return function () {
			return test1() && test2();
		};
	};

	function Task() {
		Task.superclass.constructor.apply(this, arguments);
	}
	Y.extend(Task, Y.Base, {
		initialize: function (options) {
			this.config = options.config;
			this.id = options.id;
			this.action = options.action;
			this.children = options.children;
		}
	});
	Task.prototype.render = function() {
		// this.pipeline.render(this);
	};
	Task.prototype.flush = function() {
		// this.prototype.flush();
	};

	Task.prototype.renderTest = Task.prototype.flushTest = function() {
		return true;
	};

	Pipeline.prototype.Task = Task;
	Pipeline.NAME = 'pipeline';
	Y.namespace('mojito.addons.ac').pipeline = Pipeline;
}, '0.0.1', {
	requires: ['base-base']
});