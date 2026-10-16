import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SeriesControls from "@/components/SeriesControls";

const push = jest.fn();
let search = "";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/cases/7",
  useSearchParams: () => new URLSearchParams(search),
}));

const channels = [{ code: "DO2I", name: "Indexed O2 delivery" }, { code: "MAP", name: "Mean arterial pressure" }, { code: "HB", name: "Hemoglobin" }];
const windows = [{ phase: "CROSS_CLAMP", start: "2026-01-01T10:10:00.000Z", end: "2026-01-01T11:00:00.000Z" }];

beforeEach(() => { push.mockClear(); search = "ch=DO2I,MAP"; });

it("marks the selected channels", () => {
  render(<SeriesControls channels={channels} selected={["DO2I", "MAP"]} windows={windows} />);
  expect(screen.getByLabelText("Indexed O2 delivery")).toBeChecked();
  expect(screen.getByLabelText("Hemoglobin")).not.toBeChecked();
});

it("adds a channel to the URL", async () => {
  render(<SeriesControls channels={channels} selected={["DO2I", "MAP"]} windows={windows} />);
  await userEvent.click(screen.getByTitle("Hemoglobin"));
  expect(push).toHaveBeenCalledWith("/cases/7?ch=DO2I%2CMAP%2CHB", { scroll: false });
});

it("removes a channel, and drops the parameter when none are left", async () => {
  render(<SeriesControls channels={channels} selected={["DO2I"]} windows={windows} />);
  await userEvent.click(screen.getByTitle("Indexed O2 delivery"));
  expect(push).toHaveBeenCalledWith("/cases/7?", { scroll: false });
});

it("keeps at most `max` channels, dropping the oldest", async () => {
  render(<SeriesControls channels={channels} selected={["DO2I", "MAP"]} windows={windows} max={2} />);
  await userEvent.click(screen.getByTitle("Hemoglobin"));
  expect(push).toHaveBeenCalledWith("/cases/7?ch=MAP%2CHB", { scroll: false });
});

it("jumps to a phase window and back to the whole recording", async () => {
  render(<SeriesControls channels={channels} selected={["DO2I"]} windows={windows} />);
  await userEvent.click(screen.getByRole("button", { name: "Cross-clamp" }));
  expect(push).toHaveBeenLastCalledWith(
    "/cases/7?ch=DO2I%2CMAP&from=2026-01-01T10%3A10%3A00.000Z&to=2026-01-01T11%3A00%3A00.000Z", { scroll: false });
  search = "ch=DO2I&from=x&to=y";
  await userEvent.click(screen.getByRole("button", { name: "Whole recording" }));
  expect(push).toHaveBeenLastCalledWith("/cases/7?ch=DO2I%2CMAP", { scroll: false });
});

it("can hide the channel picker and show only the window picker", () => {
  render(<SeriesControls channels={channels} selected={["DO2I"]} windows={windows} showChannels={false} />);
  expect(screen.queryByLabelText("Indexed O2 delivery")).toBeNull();
  expect(screen.getByRole("button", { name: "Cross-clamp" })).toBeInTheDocument();
});
