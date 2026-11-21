// Live speech-to-text with Apple's SpeechAnalyzer (macOS 26+), fully on-device.
// Words show up while someone is still talking ("volatile" results); each finished phrase arrives as a final result.
import AVFoundation
import Speech

final class LiveTranscriber {
    /// (final, volatile): a finished phrase, or the in-progress words. One of them is empty.
    var onText: ((String, String) -> Void)?
    private var analyzer: SpeechAnalyzer?
    private var input: AsyncStream<AnalyzerInput>.Continuation?
    private var format: AVAudioFormat?
    private var converter: AVAudioConverter?
    private var results: Task<Void, Never>?

    func start() async throws {
        let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale.current) ?? Locale(identifier: "en-US")
        let transcriber = SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [.volatileResults, .fastResults], attributeOptions: [])
        if let install = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            try await install.downloadAndInstall() // first run only: the on-device speech model for this language
        }
        format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber])
        let (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream()
        input = continuation
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        self.analyzer = analyzer
        results = Task { [weak self] in
            do {
                for try await r in transcriber.results {
                    let text = String(r.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
                    r.isFinal ? self?.onText?(text, "") : self?.onText?("", text)
                }
            } catch {}
        }
        try await analyzer.start(inputSequence: stream)
    }

    /// Called from the audio thread with whatever format the source produces.
    func feed(_ buffer: AVAudioPCMBuffer) {
        guard let format, let converted = convert(buffer, to: format) else { return }
        input?.yield(AnalyzerInput(buffer: converted))
    }

    func stop() async {
        input?.finish()
        input = nil
        try? await analyzer?.finalizeAndFinishThroughEndOfInput() // flush the last words
        await results?.value
        analyzer = nil
        results = nil
    }

    private func convert(_ buffer: AVAudioPCMBuffer, to format: AVAudioFormat) -> AVAudioPCMBuffer? {
        if buffer.format == format { return buffer }
        if converter?.inputFormat != buffer.format { converter = AVAudioConverter(from: buffer.format, to: format) }
        guard let converter else { return nil }
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * format.sampleRate / buffer.format.sampleRate) + 1
        guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return nil }
        var handed = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if handed { status.pointee = .noDataNow; return nil }
            handed = true
            status.pointee = .haveData
            return buffer
        }
        return error == nil && out.frameLength > 0 ? out : nil
    }
}

extension AVAudioPCMBuffer {
    /// ScreenCaptureKit hands audio over as CMSampleBuffers; the transcriber wants PCM buffers.
    static func from(_ sample: CMSampleBuffer) -> AVAudioPCMBuffer? {
        guard var asbd = sample.formatDescription?.audioStreamBasicDescription, let format = AVAudioFormat(streamDescription: &asbd) else { return nil }
        let frames = AVAudioFrameCount(sample.numSamples)
        guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return nil }
        buffer.frameLength = frames
        return CMSampleBufferCopyPCMDataIntoAudioBufferList(sample, at: 0, frameCount: Int32(frames), into: buffer.mutableAudioBufferList) == noErr ? buffer : nil
    }
}
