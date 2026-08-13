import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./queries/queryClient";
import { AppRouter } from "./routes/router";

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppRouter />
    </QueryClientProvider>
  );
}

export default App;
