import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProcedureFilter from "@/components/ProcedureFilter";

// Mock Next's router hooks - the component only needs to push a URL.
const push = jest.fn();
let search = "";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(search),
}));

beforeEach(() => { push.mockClear(); search = ""; });

it("lists every procedure plus an 'all' option", () => {
  render(<ProcedureFilter procedures={["CABG", "AVR"]} />);
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["All procedures", "CABG", "AVR"]);
});

it("pushes the chosen procedure into the URL", async () => {
  render(<ProcedureFilter procedures={["CABG", "AVR"]} />);
  await userEvent.selectOptions(screen.getByLabelText("Procedure"), "AVR");
  expect(push).toHaveBeenCalledWith("/dashboard?procedure=AVR");
});

it("clears the filter but keeps other query params", async () => {
  search = "procedure=CABG&surgeon=Raman";
  render(<ProcedureFilter procedures={["CABG", "AVR"]} />);
  expect(screen.getByLabelText("Procedure")).toHaveValue("CABG");
  await userEvent.selectOptions(screen.getByLabelText("Procedure"), "");
  expect(push).toHaveBeenCalledWith("/dashboard?surgeon=Raman");
});
