/**
 * Process entry point. Keeping this separate from `src/app.js` means the tests
 * can import the app without a port ever being bound.
 */
const { createApp } = require('./src/app');

const port = Number(process.env.PORT) || 3000;
createApp().listen(port, () => {
  console.log(`AirWatch running at http://localhost:${port}`);
});
