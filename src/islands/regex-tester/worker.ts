/**
 * Web Worker for the Regex Tester. Runs the match in a separate thread so a
 * catastrophically backtracking pattern can be terminated without freezing the page.
 */
import { runRegex, type RegexRequest, type RegexResult } from './logic';

interface Message {
  id: number;
  request: RegexRequest;
}

self.addEventListener('message', (event: MessageEvent<Message>) => {
  const { id, request } = event.data;
  const result: RegexResult = runRegex(request);
  (self as unknown as Worker).postMessage({ id, result });
});
