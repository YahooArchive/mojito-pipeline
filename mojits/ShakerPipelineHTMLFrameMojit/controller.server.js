/*
 * Copyright (c) 2011-2013, Yahoo! Inc.  All rights reserved.
 * Copyrights licensed under the New BSD License.
 * See the accompanying LICENSE file for terms.
 */


/*jslint nomen:true, plusplus:true*/
/*global YUI*/


YUI.add('ShakerPipelineHTMLFrameMojit', function (Y, NAME) {

    'use strict';

    Y.namespace('mojito.controllers')[NAME] = {

        index: function (ac) {
            var child = ac.config.get('child');

            this.ac = ac;
            this.flushedAssets = {
                css: [],
                js: [],
                blob: []
            };
            this.postfetch = {
                js: [],
                css: [],
                blob: []
            };
            this.binders = {};
            this._pipelineRoot(child);
        },

        _initialFlush: function (data, meta, callback) {
            var ac = this.ac;

            // Add pipeline client
            // TODO: use minified script
            if (ac.pipeline.client.jsEnabled) {
                data.pipelineClient = '<script>' + ac.pipeline.client.unminifiedScript + '</script>';
            }

            // Run Shaker
            // TODO do we need both top and shakerTop?
            meta.assets = meta.assets || {};
            ac.shaker._addRouteRollups(meta.assets, ['top', 'shakerTop']);
            ac.shaker._addAppResources(meta.assets);

            this._processMeta(meta);

            // meta.assets from child should be piped into
            // the frame's assets before doing anything else.
            ac.assets.addAssets(meta.assets);

            // we don't care much about the views specified in childs
            // and for the parent, we have a fixed one.

            meta.view = meta.view || {};

            meta.view.name = 'index';

            // 1. mixing bottom and top fragments from assets into
            //    the template data, along with title and mojito version
            //    and any other html data added through shaker
            // 2. mixing meta with child metas, along with some extra
            //    headers.
            data = Y.merge(data, ac.assets.renderLocations(), ac.shaker.data.htmlData);
            meta = Y.mojito.util.metaMerge(meta, {
                http: {
                    headers: {
                        'content-type': 'text/html; charset="utf-8"'
                    }
                }
            }, true);

            if (ac.pipeline.data.closed) {
                ac.done(data, meta);
            } else {
                this._render(data, meta, callback);
            }
        },

        _render: function (data, meta, callback) {
            var ac = this.ac,
                renderer = new Y.mojito.ViewRenderer(ac.instance.views.index.engine,
                    ac._adapter.page.staticAppConfig.viewEngine);

            data.mojit_view_id = 'ShakerPipelineHTMLFrame';

            renderer.render(data,
                ac.instance.controller,
                ac.instance.views.index,
                new Y.mojito.OutputBuffer(data.mojit_view_id, function (error, html) {
                    ac.flush(html, meta);
                    callback();
                }));
        },

        _pipelineRoot: function (root) {
            var self = this,
                ac = this.ac;

            Y.mix(root, {
                id: 'root',
                params: ac.pipeline.data.params,
                afterRender: function (event, done, task) {
                    var rootHTML = task.data,
                        meta = task.meta;
                    self._initialFlush.call(self, {
                        child: rootHTML
                    }, meta, done);
                }
            });

            ac.pipeline.configure({
                sections: {
                    root: root
                }
            }, ac.shaker.data.htmlData);
            ac.pipeline.push(root);

            if (ac.pipeline.client.jsEnabled) {
                // force the mojito client to be place on the bottom
                ac.shaker.set('serveJs', {
                    position: 'bottom'
                });
            } else {
                ac.shaker.set('serveJs', false);
            }

            ac.pipeline.on('afterFlush', function (event, done, flushData) {
                self._processMeta(flushData.meta);
                self._wrapFlushData(flushData);
                done();
            });
        },

        _processMeta: function (meta) {
            var self = this,
                flushedAssets = this.flushedAssets,
                postfetch = this.postfetch,
                binders = this.binders,
                ac = this.ac;

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

            // make sure meta has assets
            meta.assets = meta.assets || {};

            // is this is last flush, add route rollup, loader/mojito-client and bootstrap
            if (ac.pipeline.data.closed) {
                // add any postfetch assets
                Y.mojito.util.metaMerge(meta.assets, {
                    'postfetch': postfetch
                });
                ac.shaker._addRouteRollups(meta.assets, ['bottom']);
                ac.shaker._addYUILoader(meta.assets, binders);
                ac.shaker._addBootstrap(meta.assets);
            }

            ac.shaker._filterAndUpdate(meta.assets);

            if (!ac.pipeline.data.closed) {
                // remove any postfetch assets
                Y.Object.each(meta.assets.postfetch, function (typeAssets, type) {
                    Array.prototype.push.apply(postfetch[type], typeAssets);
                });

                delete meta.assets.postfetch;
            }
        },

        _wrapFlushData: function (flushData) {
            var self = this,
                top = '',
                ac = this.ac;

            // surround flush data with top and bottom
            Y.Object.each(flushData.meta.assets, function (locationAssets, location) {
                Y.Object.each(locationAssets, function (typeAssets, type) {
                    if (type === 'js' && !ac.pipeline.client.jsEnabled) {
                        return;
                    }
                    Y.Array.each(typeAssets, function (asset) {
                        var pagePositionIndex = ac.shaker.PAGE_POSITIONS.indexOf(location),
                            wrappedAsset = type === 'js' ? '<script type="text/javascript" src="' + asset + '"></script>' :
                                        type === 'css' ? '<link type="text/css" rel="stylesheet" href="' + asset + '"></link>' : asset;

                        if (location === 'postfetch' || ac.shaker.PAGE_POSITIONS.indexOf(location) > 2) {
                            flushData.data += wrappedAsset;
                        } else {
                            top += wrappedAsset;
                        }
                    });
                });
            });
            flushData.data = top + flushData.data;

            // TODO: is this even worth it?
            // merge any consecutive script
            flushData.data = flushData.data.replace(/<\/script><script>/g, '');
        }
    };

}, '0.1.0', {requires: [
    'mojito',
    'mojito-util',
    'mojito-assets-addon',
    'mojito-http-addon', // required by other mojits to get response
    'mojito-deploy-addon',
    'mojito-config-addon',
    'mojito-composite-addon',
    'mojito-shaker-addon',
    'mojito-pipeline-addon'
]});
