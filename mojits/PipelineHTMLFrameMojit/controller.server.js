/*jslint anon:true, sloppy:true, nomen:true*/
/*global YUI*/
YUI.add('PipelineHTMLFrameMojit', function (Y, NAME) {
    'use strict';
    Y.namespace('mojito.controllers')[NAME] = {

        index: function (ac) {
            var frameClosed = false,
                self = this,
                childConfig = ac.config.get('child');

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
        },

        flushFrame: function (ac, childHTML, meta, done) {
            // meta.assets from child should be piped into
            // the frame's assets before doing anything else.
            ac.assets.addAssets(meta.assets);

            if (ac.config.get('deploy') === true) {
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
                    end: !ac.pipeline.client.jsEnabled || ac.pipeline.closed ? '</body></html>' : ''
                }, {
                    title: ac.config.get('title') || 'Powered by Mojito Pipeline',
                    mojito_version: Y.mojito.version,
                    child: childHTML,
                    pipeline_client: ac.pipeline.client.unminifiedScript
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
