/*
 * Copyright (c) 2013, Yahoo! Inc.  All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */

/*jslint nomen:true, plusplus:true, continue: true */
/*global YUI */

YUI.add('PipelineFrameMojit', function (Y, NAME) {
    'use strict';

    Y.namespace('mojito.controllers')[NAME] = {

        index: function (ac) {
            var child = ac.config.get('child');

            this._init(ac);
            this._pipelineRoot(child);
        },

        _init: function (ac) {
            this.ac = ac;

            this.flushedAssets = {
                css: [],
                js: [],
                blob: []
            };

            this.view = {};
            this.meta = {};
            this.binders = {};

            // Ensure that the gzip buffer is flushed immediately...
            var response = ac.http.getResponse(), fn;

            if (response.gzip && response.gzip.flush) {
                fn = ac.flush;
                ac.flush = function () {
                    fn.apply(ac, arguments);
                    response.gzip.flush();
                };
            }
        },

        /**
         * Initializes Pipeline, pushes the root task and subscribes to flushing events in
         * order to render the this frame and wrap flushed sections with their assets.
         * @param {Object} rootConfig The root level mojit config passed to this HTMLFrame.
         */
        _pipelineRoot: function (rootConfig) {
            var self = this,
                ac = this.ac,
                renderedFrame;

            rootConfig.id = 'root';
            ac.pipeline.initialize(self.view);

            ac.pipeline.push(rootConfig);

            if (ac.pipeline.client.enabled) {
                // If the Pipeline client is enabled, process the meta data, add the mojito client and wrap the serialized tasks
                // with their assets. If this is the first flush, prepend the rendered frame to the flush data.
                ac.pipeline.onAsync('pipeline', 'beforeFlush', function (event, done, flushData) {
                    var processFlushData = function () {
                        flushData.meta.assets = flushData.meta.assets || {};
                        self._processMeta(flushData.meta);
                        self._addMojitoClient(flushData.meta);
                        self._wrapFlushData(flushData);
                    };

                    if (renderedFrame === undefined) {
                        // Stub the root tasks position since the root section will be pushed in the client-side.
                        self.view.child = '<div id="root-section"></div>';
                        self._render(function (data, meta) {
                            processFlushData();
                            renderedFrame = data;
                            flushData.data = renderedFrame + flushData.data;
                            flushData.meta = meta;
                            done();
                        });
                        return;
                    }

                    processFlushData();
                    done();
                });
            } else {
                // If the Pipeline client is disabled, render the frame with the rendered root section.
                ac.pipeline.onAsync('root', 'afterRender', function (event, done, root) {
                    self.view.child = root.data;
                    self.meta = root.meta;
                    self._processMeta(self.meta);
                    self._render(function (data, meta) {
                        renderedFrame = data;
                        done();
                    });
                });

                // Prepend the flush data with the rendered frame.
                ac.pipeline.on('pipeline', 'beforeFlush', function (event, flushData) {
                    flushData.data = renderedFrame + flushData.data;
                    flushData.meta = self.meta;
                });
            }
        },

        /**
         * Renders this frame using the available view data, and meta.
         * @param {Object} view The data to be passed to this frame's view.
         * @param {Object} meta The meta data currently available.
         * @param {Function} callback The function to call after rendering.
         */
        _render: function (callback) {
            var view = this.view,
                meta = this.meta,
                ac = this.ac,
                renderer = new Y.mojito.ViewRenderer(ac.instance.views.index.engine,
                    ac._adapter.page.staticAppConfig.viewEngine);

            meta.view = {
                name: 'index'
            };

            // Add pipeline client to the view data.
            if (ac.pipeline.client.enabled) {
                view.pipelineClient = '<script>' + ac.pipeline.client.script + '</script>';
            }

            // Pass the assets to this frame's asset, such that they appear in the rendered view.
            ac.assets.addAssets(meta.assets);

            // Merge the rendered assets with the view data.
            view = Y.merge(view, ac.assets.renderLocations());
            // Make sure the meta data has an HTTP header that specifies the content-type
            // as text/html, such that the client renders the page as HTML.
            meta = Y.mojito.util.metaMerge(meta, {
                http: {
                    headers: {
                        'content-type': 'text/html; charset="utf-8"'
                    }
                }
            }, true);

            // Render this frame's view and pass the rendered page to the callback.
            renderer.render(view,
                ac.instance.controller,
                ac.instance.views.index,
                new Y.mojito.OutputBuffer(NAME, function (error, html) {
                    callback(html, meta);
                }));
        },

        /**
         * Process the meta data by filtering out any asset that has already been flushed.
         * @param {Object} meta The meta data to be processed.
         */
        _processMeta: function (meta) {
            var flushedAssets = this.flushedAssets,
                binders = this.binders;

            // Keep track of all the binders associated with each flush, so that they can be used to
            // construct the Mojito client on the last flush.
            Y.mix(binders, meta.binders);

            // filter out any asset that has already been flushed
            Y.Object.each(meta.assets, function (locationAssets, location) {
                Y.Object.each(locationAssets, function (typeAssets, type) {
                    var i = 0,
                        asset;
                    while (i < typeAssets.length) {
                        asset = typeAssets[i];
                        if (flushedAssets[type] && flushedAssets[type].indexOf(asset) !== -1) {
                            typeAssets.splice(i, 1);
                            continue;
                        }
                        if (flushedAssets[type]) {
                            flushedAssets[type].push(asset);
                        }
                        i++;
                    }
                });
            });
        },

        /**
         * Adds the Mojito client runtime to the meta data.
         * @param {Object} meta
         */
        _addMojitoClient: function (meta) {
            var ac = this.ac,
                binders = this.binders;

            // Construct the Mojito client runtime if this it the last flush and the Mojito client should be deployed.
            if (ac.pipeline.closed && ac.config.get('deploy') === true) {
                // Clear any assets such that only the Mojito client runtime appears.
                ac.assets.assets = {};
                // Get the Mojito client assets.
                ac.deploy.constructMojitoClientRuntime(ac.assets, binders);

                // Make sure that meta data assets have a bottom with js and blob
                // in order to receive the Mojito client runtime.
                meta.assets.bottom = meta.assets.bottom || {};
                meta.assets.bottom.js = meta.assets.bottom.js || [];
                meta.assets.bottom.blob = meta.assets.bottom.blob || [];

                // All Mojito client assets should go on the bottom, to ensure that scripts are
                // downloaded after any inline script is executed.
                Array.prototype.push.apply(meta.assets.bottom.js, ac.assets.assets.top.js);
                Array.prototype.push.apply(meta.assets.bottom.blob, ac.assets.assets.bottom.blob);
            }
        },

        /**
         * Wraps the data to be flushed with any corresponding rendered assets.
         * @param {Object} flushData The data to be flushed.
         */
        _wrapFlushData: function (flushData) {
            var self = this,
                renderedAssets = {
                    'top': '',
                    'bottom': ''
                },
                ac = this.ac;

            // Surround flush data with top and bottom rendered assets.
            Y.Object.each(flushData.meta.assets, function (locationAssets, location) {
                Y.Object.each(locationAssets, function (typeAssets, type) {
                    // Don't add JS assets if JS is disabled.
                    if (type === 'js' && !ac.pipeline.client.jsEnabled) {
                        return;
                    }
                    Y.Array.each(typeAssets, function (asset) {
                        var renderedAsset = type === 'js' ? '<script type="text/javascript" src="' + asset + '"></script>' :
                                        type === 'css' ? '<link type="text/css" rel="stylesheet" href="' + asset + '"></link>' : asset;
                        // Concatenates the rendered assets to the renderedAssets.top/bottom buffers.
                        self._concatRenderedAssets(renderedAsset, renderedAssets, location, type);
                    });
                });
            });

            flushData.data = renderedAssets.top + flushData.data + renderedAssets.bottom;
        },

        /**
         * Concatenates the rendered assets to the top and bottom buffers of renderedAssets.
         * This function can be used by HTML frames extending this frame in order to define where
         * a rendered assets should be placed based on its location and type.
         * @param {String} renderedAsset The rendered JS or CSS asset.
         * @param {Object} renderedAssets Object containing top and bottom string buffers for rendered assets.
         * @param {String} location The location of the rendered asset.
         * @param {String} type The type of the rendered asset.
         */
        _concatRenderedAssets: function (renderedAsset, renderedAssets, location, type) {
            if (location === 'top') {
                renderedAssets.top += renderedAsset;
            } else {
                renderedAssets.bottom += renderedAsset;
            }
        }
    };

}, '0.1.0', {
    requires: [
        'mojito',
        'mojito-util',
        'mojito-assets-addon',
        'mojito-http-addon',
        'mojito-deploy-addon',
        'mojito-config-addon',
        'mojito-pipeline-addon'
    ]
});
