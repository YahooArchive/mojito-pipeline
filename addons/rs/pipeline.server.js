/*
 * Copyright (c) 2013, Yahoo! Inc. All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */

/*jslint node: true */
/*global YUI */

/**
 * Handles pipeline's client-side minification
 */

YUI.add('addon-rs-pipeline', function (Y, NAME) {
    'use strict';

    var async = require('async'),
        parser = require('uglify-js').parser,
        uglify = require('uglify-js').uglify;

    function RSAddonPipeline() {
        RSAddonPipeline.superclass.constructor.apply(this, arguments);
    }

    RSAddonPipeline.NS = 'pipeline';
    RSAddonPipeline.ATTRS = {};

    Y.extend(RSAddonPipeline, Y.Plugin.Base, {

        initializer: function (config) {
            this.rs = config.host;
            this.afterHostMethod('resolveResourceVersions', this.minifyPipelineClient);
        },

        minifyPipelineClient: function () {
            var self = this,
                resources = this.rs.getResourceVersions({mojit: 'shared'}),
                eventsModule,
                pipelineClient;

            Y.Array.some(resources, function (resource) {
                if (resource.id === 'yui-module--target-action-events') {
                    eventsModule = resource;
                } else if (resource.id === 'asset-js-void/pipeline-client') {
                    pipelineClient = resource;
                }

                if (eventsModule && pipelineClient) {
                    return true;
                }
            });

            async.each([eventsModule, pipelineClient],
                function (resource, resourceDone) {
                    self.rs.getResourceContent(self.rs.makeStaticHandlerDetails(resource), function (err, content) {
                        resource.content = content.toString();
                        resourceDone(err);
                    });
                },
                function (err) {
                    // TODO: handle when unable to read one of the modules
                    self.unminifiedClient = eventsModule.content + pipelineClient.content;
                    self.client = self.minify(self.unminifiedClient);
                });
        },

        minify: function (originalSource) {
            var comments = [],
                token = '"jsminify task: preserved comment block"',
                reMultiComments = /\/\*![\s\S]*?\*\//g,
                reTokens = new RegExp(token, 'g'),
                ast,
                source = originalSource;

            try {
                source = source.replace(reMultiComments, function (comment) {
                    comments.push(comment);
                    return ';' + token + ';';
                });

                ast = parser.parse(source, false);

                ast = uglify.ast_mangle(ast, {});
                ast = uglify.ast_squeeze(ast, {});

                source = uglify.gen_code(ast, {});

                source = source.replace(reTokens, function () {
                    return '\n' + comments.shift() + '\n';
                });

                if (source.substr(source.length - 1) === ')') {
                    source += ';';
                }
                source += '\n';
                return source;
            } catch (e) {
                return originalSource;
            }
        }

    });

    Y.namespace('mojito.addons.rs').pipeline = RSAddonPipeline;

}, '0.0.1', {
    requires: [
        'plugin',
        'oop'
    ]
});
