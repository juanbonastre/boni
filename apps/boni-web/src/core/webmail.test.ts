import { describe, expect, it } from "vitest";
import { webmailLink, webmailOf } from "./webmail.ts";

describe("a mail in its webmail (task 55)", () => {
  it("knows Gmail by the mailbox's host, and no other webmail", () => {
    expect(webmailOf("imap.gmail.com")).toBe("gmail");
    expect(webmailOf("imap.googlemail.com")).toBe("gmail");
    expect(webmailOf("outlook.office365.com")).toBeNull();
    expect(webmailOf("gmail.com.example.net")).toBeNull();
  });

  it("opens a mail by its Message-ID with Gmail's search, from the id alone", () => {
    expect(webmailLink("imap.gmail.com", "abc123@mail.example.com")).toEqual({
      name: "Gmail",
      url: "https://mail.google.com/mail/u/0/#search/rfc822msgid:abc123%40mail.example.com",
    });
    expect(webmailLink("imap.gmail.com", "<abc@x.example>")?.url).toContain(
      "rfc822msgid:abc%40x.example",
    );
    expect(webmailLink("outlook.office365.com", "abc@x.example")).toBeNull();
    expect(webmailLink("imap.gmail.com", "")).toBeNull();
    expect(webmailLink("imap.gmail.com", "with space@x.example")).toBeNull();
    expect(webmailLink("imap.gmail.com", `a"b@x.example`)).toBeNull();
  });
});
