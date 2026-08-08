declare module "*.css";

declare module "react-dom/server.browser" {
  import * as ReactDOMServer from "react-dom/server";
  export default ReactDOMServer;
}
