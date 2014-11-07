var express = require('express'),
    mojito = require('mojito'),
    app = express();

mojito.extend(app);

app.use(mojito.middleware());
app.mojito.attachRoutes();

app.set('port', process.env.PORT || 8666);

app.listen(app.get('port'));

module.exports = app;
