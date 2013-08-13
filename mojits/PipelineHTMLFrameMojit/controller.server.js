/*jslint anon:true, sloppy:true, nomen:true*/
/*global YUI*/
YUI.add('PipelineHTMLFrameMojit', function (Y, NAME) {
    'use strict';
    Y.namespace('mojito.controllers')[NAME] = {

        index: function (ac) {
            var frameClosed = false,
                self = this,
                childConfig = ac.config.get('child'),
                flushedAssets = {
                    css: [],
                    js: [],
                    blob: []
                },
                binders = {};

            Y.mix(childConfig, {
                id: 'root',
                afterRender: function (event, done, childHTML, meta) {
                    self.flushFrame(ac, childHTML, meta, done);
                }
            });

            ac.pipeline.configure({
                sections: {
                    root: childConfig
                }
            });
            ac.pipeline.push(childConfig);

            ac.pipeline.on('flush', function (event, done, flushData) {
                Y.mix(binders, flushData.meta.binders);
                if (ac.pipeline.data.closed && ac.config.get('deploy') === true) {
                    var mojitoClientAssets = {};
                    ac.assets.assets = mojitoClientAssets;
                    ac.deploy.constructMojitoClientRuntime(ac.assets, binders);
                    flushData.meta.assets.bottom = flushData.meta.assets.bottom || {};
                    flushData.meta.assets.bottom.js = flushData.meta.assets.bottom.js || [];
                    flushData.meta.assets.bottom.blob = flushData.meta.assets.bottom.blob || [];
                    Array.prototype.push.apply(flushData.meta.assets.bottom.js, mojitoClientAssets.top.js);
                    Array.prototype.push.apply(flushData.meta.assets.bottom.blob, mojitoClientAssets.bottom.blob);
                }
                // surround flush data with top and bottom
                Y.Object.each(flushData.meta.assets, function (locationAssets, location) {
                    Y.Object.each(locationAssets, function (typeAssets, type) {
                        Y.Array.each(typeAssets, function (asset) {
                            // skip assets of unknown type and those that have been flushed in the past
                            if (!flushedAssets[type] || flushedAssets[type].indexOf(asset) !== -1) {
                                return;
                            }
                            flushedAssets[type].push(asset);
                            var wrappedAsset = type === 'js' ? '<script type="text/javascript" src="' + asset + '"></script>' :
                                type === 'css' ? '<link type="text/css" rel="stylesheet" href="' + asset + '"></link>' :
                                asset;
                            if (location === 'top') {
                                flushData.data = wrappedAsset + flushData.data;
                            } else {
                                flushData.data += wrappedAsset;
                            }
                        });
                    });
                });

                done();
            });
        },

        flushFrame: function (ac, childHTML, meta, done) {
            // meta.assets from child should be piped into
            // the frame's assets before doing anything else.
            ac.assets.addAssets(meta.assets);

            if (ac.pipeline.closed && ac.config.get('deploy') === true) {
                ac.deploy.constructMojitoClientRuntime(ac.assets,
                    meta.binders);
            }

            // we don't care much about the views specified in childs
            // and for the parent, we have a fixed one.
            meta.view = {
                name: 'index'
            };

            var renderer,
                data = Y.merge(ac.pipeline.htmlData, ac.assets.renderLocations(), {
                    end: !ac.pipeline.client.jsEnabled || ac.pipeline.data.closed ? '</body></html>' : ''
                }, {
                    title: ac.config.get('title') || 'Powered by Mojito Pipeline',
                    mojito_version: Y.mojito.version,
                    child: childHTML,
                    pipeline_client: '<script>' + ac.pipeline.client.unminifiedScript + '</script>'
                });

            meta = Y.mojito.util.metaMerge(meta, {
                http: {
                    headers: {
                        'content-type': 'text/html; charset="utf-8"'
                    }
                }
            }, true);

            // 1. mixing bottom and top fragments from assets into
            //    the template data, along with title and mojito version.
            // 2. mixing meta with child metas, along with some extra
            //    headers.
            if (ac.pipeline.closed) {
                ac.done(data, meta);
            } else {
                renderer = new Y.mojito.ViewRenderer(ac.instance.views.index.engine,
                    ac._adapter.page.staticAppConfig.viewEngine);

                data.mojit_view_id = 'PipelineHTMLFrame';

                renderer.render(data,
                    ac.instance.controller,
                    ac.instance.views.index,
                    new Y.mojito.OutputBuffer(data.mojit_view_id, function (error, html) {
                        ac.flush(html, meta);
                        done();
                    }));

            }

        }
    };

}, '0.1.0', {requires: [
    'mojito',
    'mojito-util',
    'mojito-http-addon',
    'mojito-assets-addon',
    'mojito-deploy-addon',
    'mojito-config-addon',
    'mojito-pipeline-addon'
]});
