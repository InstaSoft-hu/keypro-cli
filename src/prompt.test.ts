import { describe, it, expect } from "vitest";
import { consumeHiddenChunk } from "./prompt.js";

const ESC = String.fromCharCode(27);
const PASTE_START = ESC + "[200~";
const PASTE_END = ESC + "[201~";
const EOT = String.fromCharCode(4); // Ctrl-D
const ETX = String.fromCharCode(3); // Ctrl-C
const DEL = String.fromCharCode(127);
const BS = String.fromCharCode(8);

describe("consumeHiddenChunk", () => {
  it("gepelt karakter: tovabb var (typing)", () => {
    expect(consumeHiddenChunk("", "d")).toEqual({ value: "d", status: "typing" });
    expect(consumeHiddenChunk("dem", "o")).toEqual({ value: "demo", status: "typing" });
  });

  it("Enter (CR/LF): submit a felhalmozott ertekkel", () => {
    expect(consumeHiddenChunk("demo1234", "\r")).toEqual({ value: "demo1234", status: "submit" });
    expect(consumeHiddenChunk("demo1234", "\n")).toEqual({ value: "demo1234", status: "submit" });
  });

  it("EOT (Ctrl-D): submit", () => {
    expect(consumeHiddenChunk("demo1234", EOT)).toEqual({ value: "demo1234", status: "submit" });
  });

  it("REGRESSZIO: beillesztett jelszo bracketed-paste jelolokkel + Enter egy chunkban", () => {
    const pasted = PASTE_START + "demo1234" + PASTE_END + "\r";
    expect(consumeHiddenChunk("", pasted)).toEqual({ value: "demo1234", status: "submit" });
  });

  it("beillesztett jelszo zaro ujsor nelkul: jelolok leszedve, meg var", () => {
    const pasted = PASTE_START + "demo1234" + PASTE_END;
    expect(consumeHiddenChunk("", pasted)).toEqual({ value: "demo1234", status: "typing" });
  });

  it("egy chunkban erkezo jelszo + ujsor (bracketed paste nelkul is helyes)", () => {
    expect(consumeHiddenChunk("", "demo1234\n")).toEqual({ value: "demo1234", status: "submit" });
  });

  it("csak a kezdo jelolo erkezik ebben a chunkban (chunkokra bomlott paste)", () => {
    expect(consumeHiddenChunk("", PASTE_START + "demo")).toEqual({ value: "demo", status: "typing" });
    expect(consumeHiddenChunk("demo", "1234" + PASTE_END + "\r")).toEqual({
      value: "demo1234",
      status: "submit",
    });
  });

  it("backspace (DEL es BS) egy karaktert torol", () => {
    expect(consumeHiddenChunk("demoX", DEL)).toEqual({ value: "demo", status: "typing" });
    expect(consumeHiddenChunk("demoX", BS)).toEqual({ value: "demo", status: "typing" });
  });

  it("Ctrl-C: cancel", () => {
    expect(consumeHiddenChunk("demo", ETX)).toEqual({ value: "demo", status: "cancel" });
  });

  it("unicode jelszo karakterek megmaradnak", () => {
    expect(consumeHiddenChunk("", "arvizturo")).toEqual({ value: "arvizturo", status: "typing" });
  });
});
