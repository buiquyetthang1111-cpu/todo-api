'use strict';

const { createApp } = require('./app');

const PORT = process.env.PORT || 3000;

createApp({ seed: true }).listen(PORT, () => {
  console.log(`Todo API listening on http://localhost:${PORT}`);
});
