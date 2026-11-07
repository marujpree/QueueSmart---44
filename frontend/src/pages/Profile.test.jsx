// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Profile from "./Profile";
import { apiGet, apiPatch } from "../api";

vi.mock("../api", () => ({ apiGet: vi.fn(), apiPatch: vi.fn() }));
vi.mock("../components/UserShell", () => ({ default: ({ children }) => <main>{children}</main> }));
const profile = { userId: 6, fullName: "Database Name", email: "student@example.com", phone: null, preferences: {} };
const show = () => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Profile /></MemoryRouter>);
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  apiGet.mockResolvedValue({ profile });
});
afterEach(cleanup);

describe("Profile form", () => {
  it("loads saved fields from the backend rather than a local cache", async () => {
    localStorage.setItem("queuesmart.user", JSON.stringify({ id: 6, name: "Old local name" }));
    show();
    const name = await screen.findByLabelText(/Full name/);
    expect(name.value).toBe("Database Name");
    expect(apiGet).toHaveBeenCalledWith("/profiles/me");
    expect(screen.getByLabelText("Account email").readOnly).toBe(true);
  });
  it("submits edited details to PATCH and shows the saved response", async () => {
    const user = userEvent.setup();
    apiPatch.mockResolvedValue({ profile: { ...profile, fullName: "Updated Student", phone: "713-555-1234", preferences: { contactMethod: "phone" } } });
    show();
    const name = await screen.findByLabelText(/Full name/);
    await user.clear(name);
    await user.type(name, "Updated Student");
    await user.type(screen.getByLabelText(/Phone number/), "713-555-1234");
    await user.selectOptions(screen.getByLabelText("Preferred contact method"), "phone");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    await screen.findByText("Your profile has been saved.");
    expect(apiPatch).toHaveBeenCalledWith("/profiles/me", { fullName: "Updated Student", phone: "713-555-1234", preferences: { contactMethod: "phone" } });
  });
  it("rejects missing names and invalid contact info without submitting", async () => {
    const user = userEvent.setup();
    show();
    await user.clear(await screen.findByLabelText(/Full name/));
    await user.type(screen.getByLabelText(/Phone number/), "abc");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(screen.getByText("Full name is required.")).toBeTruthy();
    expect(screen.getByText("Enter a valid phone number.")).toBeTruthy();
    expect(apiPatch).not.toHaveBeenCalled();
  });
  it("requires a phone number for a phone contact preference", async () => {
    const user = userEvent.setup();
    show();
    await screen.findByLabelText(/Full name/);
    await user.selectOptions(screen.getByLabelText("Preferred contact method"), "phone");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(screen.getByText(/Add a phone number before/)).toBeTruthy();
    expect(apiPatch).not.toHaveBeenCalled();
  });
  it("displays backend validation errors", async () => {
    const user = userEvent.setup();
    apiPatch.mockRejectedValue(Object.assign(new Error("Please fix the highlighted fields."), { fields: { phone: "Invalid phone from server." } }));
    show();
    await screen.findByLabelText(/Full name/);
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(await screen.findByText("Invalid phone from server.")).toBeTruthy();
  });
  it("shows a load failure and can retry", async () => {
    const user = userEvent.setup();
    apiGet.mockRejectedValueOnce(new Error("Could not load profile."));
    show();
    await screen.findByText("Could not load profile.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByLabelText(/Full name/).value).toBe("Database Name"));
  });
});
