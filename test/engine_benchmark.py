"""Offline, repeatable extraction and autofill measurements using synthetic data."""
import argparse
import io
import json
import statistics
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile

from playwright.sync_api import expect, sync_playwright

import offerlink_regression as offerlink
from screenshot import CHROME_MOCK


class StreamingZip(io.BytesIO):
    def seek(self, *_args):
        raise OSError("stream is not seekable")


def make_docx(embedded_media=False, streaming=False):
    stream = StreamingZip() if streaming else io.BytesIO()
    xml = """<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body><w:p><w:r><w:t>林示例</w:t><w:tab/><w:t>前端工程师</w:t></w:r></w:p>
      <w:p><w:r><w:t>项目 A &amp; B&apos;s &#x1F680;</w:t></w:r></w:p></w:body></w:document>"""
    with ZipFile(stream, "w", ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", xml)
        if embedded_media:
            for index in range(8):
                archive.writestr(f"word/media/image{index}.png", bytes(range(256)) * 8192)
    return stream.getvalue()


def make_pdf():
    stream = b"BT /F1 18 Tf 72 700 Td (Name: Lin Example) Tj 0 -28 Td (Role: Frontend Engineer) Tj ET\n"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"endstream",
    ]
    pdf = bytearray(b"%PDF-1.4\n")
    offsets = []
    for index, obj in enumerate(objects, 1):
        offsets.append(len(pdf))
        pdf.extend(f"{index} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(pdf)
    pdf.extend(b"xref\n0 6\n0000000000 65535 f \n")
    for offset in offsets:
        pdf.extend(f"{offset:010d} 00000 n \n".encode())
    pdf.extend(f"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return pdf


def run_parser(playwright, profile_dir):
    extension = str(offerlink.EXT)
    browser = playwright.chromium.launch_persistent_context(str(profile_dir), channel="chromium", headless=True,
        args=[f"--disable-extensions-except={extension}", f"--load-extension={extension}"])
    try:
        worker = browser.service_workers[0] if browser.service_workers else browser.wait_for_event("serviceworker")
        page = browser.pages[0]
        page.goto(worker.url.split("/scripts/")[0] + "/options/options.html")
        return page.evaluate("""async ([docxBytes, streamingBytes, pdfBytes]) => {
          await ensurePdfJs();
          const word = bytes => new File([new Uint8Array(bytes)], 'resume.docx');
          const timings = [];
          const docx = word(docxBytes);
          await resumeParser.extractText(docx);
          let text;
          for (let i = 0; i < 7; i++) {
            const start = performance.now();
            text = await resumeParser.extractText(docx);
            timings.push(performance.now() - start);
          }
          let streamed = '';
          try { streamed = await resumeParser.extractText(word(streamingBytes)); } catch {}
          const pdf = await resumeParser.extractText(new File([new Uint8Array(pdfBytes)], 'resume.pdf'));
          const cases = [
            ['metadata before fenced JSON',
              '日志 {"usage": 12}\\n```JSON\\n{"basicInfo":{"fullName":"林示例"}}\\n```',
              result => result.basicInfo.fullName === '林示例'],
            ['invalid entries keep valid neighbours',
              '{"education":[null,{"school":"示例大学","academicDegree":"工学学士"}]}',
              result => result.education.length === 1 && result.education[0].academicDegree === '工学学士'],
            ['repair preserves literal punctuation',
              '{"introduction":"literal }{ and ,}","skills":["Python"\\n"Docker"]}',
              result => result.introduction === 'literal }{ and ,}' && result.skills.length === 2]
          ];
          const checks = Object.fromEntries(cases.map(([name, input, expected]) => {
            try { return [name, expected(resumeParser.parseAIResponse(input))]; } catch { return [name, false]; }
          }));
          return { timings, checks: {
            'Word body, tabs and entities': text.includes('林示例\\t前端工程师') && text.includes("项目 A & B's 🚀"),
            'Word data descriptor': streamed.includes('前端工程师'),
            'PDF line boundaries': /^Name: Lin Example\\nRole: Frontend Engineer$/.test(pdf),
            ...checks
          }};
        }""", [list(make_docx(embedded_media=True)), list(make_docx(streaming=True)), list(make_pdf())])
    finally:
        browser.close()


def run_fill(playwright, origin):
    _, scripts, styles = offerlink.read_content_assets()
    data, profile = offerlink.build_demo_data()
    browser = playwright.chromium.launch(executable_path=offerlink.chrome_path(), headless=True,
        args=["--no-proxy-server", f"--host-resolver-rules=MAP {offerlink.HOST} 127.0.0.1"])
    context = browser.new_context(viewport={"width": 1440, "height": 1000}, locale="zh-CN")
    context.add_init_script("window.__CAPYBARA_DEMO__ = " + json.dumps(data, ensure_ascii=False))
    context.add_init_script(CHROME_MOCK)
    timings = {"full": [], "incremental": []}
    expected = {
        "homeProvince": profile["basicInfo"]["homeProvince"], "homeCity": profile["basicInfo"]["homeCity"],
        "school1": profile["education"][0]["school"], "school2": profile["education"][1]["school"],
        "studentId2": profile["education"][1]["studentId"], "projectName1": profile["projects"][0]["name"],
        "projectName2": profile["projects"][1]["name"], "certName1": profile["certificates"][0]["name"],
        "langScore1": profile["languageCertificates"][0]["score"], "langDate2": profile["languageCertificates"][1]["obtainedDate"],
        "trainingName1": profile["trainings"][0]["name"],
    }
    checks = {f"OfferLink full {key}": True for key in expected}
    checks["OfferLink leaves confirmation to user"] = True
    checks["OfferLink incremental keeps prior value"] = True
    try:
        for mode in timings:
            for index in range(6):
                page = offerlink.load_fixture_page(context, origin, scripts, styles)
                if mode == "incremental":
                    page.locator("#school1").fill("人工填写的学校")
                result = offerlink.run_fill(page, profile, mode)
                assert not result["error"] and not result["cancelled"], result["error"]
                if index:
                    timings[mode].append(result["durationMs"])
                if mode == "full":
                    actual = offerlink.snapshot_values(page)
                    for key, value in expected.items():
                        checks[f"OfferLink full {key}"] &= actual[key] == value
                    state = offerlink.danger_state(page)
                    checks["OfferLink leaves confirmation to user"] &= (
                        page.locator("#entryConfirmModal").is_visible() and not any(state["counters"].values()))
                else:
                    checks["OfferLink incremental keeps prior value"] &= page.locator("#school1").input_value() == "人工填写的学校"
                page.close()

        page = offerlink.load_fixture_page(context, origin, scripts, styles)
        page.evaluate("""() => {
            history.replaceState(null, '', '/synthetic-form');
            document.body.innerHTML = `
              <label for="contactField">联系方式</label><input type="email" name="contact" id="contactField" autocomplete="email">
              <label for="phoneField">联系方式</label><input type="tel" name="email" id="phoneField" autocomplete="tel">
              <label for="schoolField">毕业院校</label><input type="text" id="schoolField" name="contact" autocomplete="email">
              <label for="secretField">姓名</label><input type="text" id="secretField" name="name" autocomplete="one-time-code">
            `;
        }""")
        offerlink.run_fill(page, profile, "full")
        for key, value in {
            "contactField": profile["basicInfo"]["email"],
            "phoneField": profile["basicInfo"]["phone"],
            "schoolField": profile["education"][0]["school"],
            "secretField": "",
        }.items():
            checks[f"Generic form {key}"] = page.locator(f"#{key}").input_value() == value
    finally:
        context.close()
        browser.close()
    return timings, checks


def main():
    cli = argparse.ArgumentParser()
    cli.add_argument("--measure-only", action="store_true", help="Print results even when a pre-fix check fails.")
    args = cli.parse_args()
    server, origin = offerlink.start_server()
    try:
        with TemporaryDirectory(prefix="easyoffer-engine-") as tmp, sync_playwright() as playwright:
            parser = run_parser(playwright, Path(tmp) / "profile")
            fill_times, fill_checks = run_fill(playwright, origin)
    finally:
        server.shutdown()
        server.server_close()
    checks = {**parser["checks"], **fill_checks}
    times = {"docx_ms": parser["timings"], "offerlink_full_ms": fill_times["full"], "offerlink_incremental_ms": fill_times["incremental"]}
    print(json.dumps({"medians": {key: round(statistics.median(values), 2) for key, values in times.items()},
        "samples": times, "checks": checks}, ensure_ascii=False))
    failed = sum(not passed for passed in checks.values())
    print(f"PASS {len(checks) - failed} FAIL {failed}")
    return 0 if args.measure_only or not failed else 1


if __name__ == "__main__":
    sys.exit(main())
