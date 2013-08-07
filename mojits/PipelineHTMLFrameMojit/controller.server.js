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
                id: 'child',
                flushTest: function () {
                    return false;
                },
                afterRender: function (event, done, childHTML, meta) {
                    self.flushFrame(ac, childHTML, meta);
                    done();
                }
            });

            ac.pipeline.configure(childConfig);
            ac.pipeline.push(childConfig);
            ac.pipeline.close();
        },

        flushFrame: function (ac, childHTML, meta) {
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

            // 1. mixing bottom and top fragments from assets into
            //    the template data, along with title and mojito version.
            // 2. mixing meta with child metas, along with some extra
            //    headers.
            ac.done(
                Y.merge(ac.pipeline.htmlData, ac.assets.renderLocations(), {
                    end: !ac.pipeline.client.jsEnabled || ac.pipeline.closed ? '</html>' : ''
                }, {
                    title: ac.config.get('title') || 'Powered by Mojito Pipeline',
                    mojito_version: Y.mojito.version,
                    child: childHTML
                }),
                Y.mojito.util.metaMerge(meta, {

                    http: {
                        headers: {
                            'content-type': 'text/html; charset="utf-8"'
                        }
                    }

                }, true)
            );
        }
    };

}, '0.1.0', {requires: [
    'mojito',
    'mojito-util',
    'mojito-assets-addon',
    'mojito-deploy-addon',
    'mojito-config-addon',
    'mojito-pipeline-addon'
]});
