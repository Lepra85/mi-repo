const express = require("express");
const path = require("path");

const app = express();
app.use(express.static(__dirname));

const port = process.env.PORT || 3000;
app.listen(port, "0.0.0.0", () => {
  console.log(`colombianazo listening on ${port}`);
});
