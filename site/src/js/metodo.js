import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "../css/style.css";

import { load } from "./lib/data.js";
import { chrome } from "./lib/ui.js";

load("meta.json")
  .then((meta) => chrome("metodo", meta))
  .catch(() => chrome("metodo", null));
