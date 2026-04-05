import { BrowserRouter } from "react-router-dom";

import { AppRoutes } from "./app/app-routes";

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
