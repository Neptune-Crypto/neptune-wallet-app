import { useAppDispatch } from "@/store/hooks";
import { useLogs } from "@/store/log/hooks";
import { queryLogMessages } from "@/store/log/log-slice";
import { Flex, ScrollArea } from "@mantine/core";
import Ansi from "ansi-to-react";
import { memo, useEffect, useRef, useState } from "react";
import "./index.css";

// Memoized so an existing line is not re-parsed (ansi-to-react is not cheap) when
// new lines arrive; only lines whose text actually changed re-render.
const LogLine = memo(function LogLine({ line }: { line: string }) {
  return <Ansi useClasses>{line}</Ansi>;
});

// The log viewer, rendered as the "Logs" tab inside Settings. It manages its own
// polling and tails the latest output: it jumps to the bottom instantly as new
// lines arrive, unless the user has scrolled up. ("Clear logs" lives in the tab
// strip of the Settings page.)
export function LogView() {
  const dispatch = useAppDispatch();
  const logs = useLogs();
  const viewport = useRef<HTMLDivElement>(null);
  const [followTail, setFollowTail] = useState(true);

  // Jump straight to the bottom. No smooth animation, which is slow to travel the
  // full height of a long log on open.
  const scrollToBottom = () =>
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight });

  useEffect(() => {
    const timerId = setInterval(() => {
      dispatch(queryLogMessages());
    }, 1000);
    return () => clearInterval(timerId);
  }, [dispatch]);

  // While following the tail, stay pinned to the bottom as new lines arrive.
  useEffect(() => {
    if (followTail) {
      scrollToBottom();
    }
  }, [logs, followTail]);

  const handleScroll = ({ y }: { x: number; y: number }) => {
    const el = viewport.current;
    if (!el) return;
    const atBottom = el.scrollHeight - (y + el.clientHeight) < 20;
    setFollowTail(atBottom);
  };

  return (
    <>
      <ScrollArea
        h={"calc(100vh - 170px)"}
        type="auto"
        scrollbarSize={8}
        viewportRef={viewport}
        onScrollPositionChange={handleScroll}
        style={{ marginRight: -24 }}
        styles={{ viewport: { paddingRight: 24 } }}
      >
        <Flex
          className="log-view"
          direction="column"
          gap="16"
          style={{
            fontSize: "14px",
            wordWrap: "break-word",
            wordBreak: "break-all",
          }}
        >
          {logs &&
            logs.length > 0 &&
            logs.map((log, index) => {
              return <LogLine key={index} line={log} />;
            })}
        </Flex>
      </ScrollArea>
    </>
  );
}

export default LogView;
