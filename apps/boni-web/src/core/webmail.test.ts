import { describe, expect, it } from "vitest";
import { webmailOf } from "./webmail.ts";

describe("a mail in its webmail (tasks 55 and 68)", () => {
  it("knows Gmail by the mailbox's host, and no other webmail", () => {
    expect(webmailOf("imap.gmail.com")).toBe("gmail");
    expect(webmailOf("imap.googlemail.com")).toBe("gmail");
    expect(webmailOf("outlook.office365.com")).toBeNull();
    expect(webmailOf("gmail.com.example.net")).toBeNull();
  });
});
