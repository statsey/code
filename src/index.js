const express = require('express');
const app = express();
const port = process.evn.port || 8000

app.get('/', (req, res) => {
  res.send('homepade fucker');
});

app.use(express.json());

const cors = require("cors");
app.use(cors());

app.listen(port, () => {
  console.log(`Server started on the port something idfk ${port}`);
});
