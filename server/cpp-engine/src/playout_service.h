#pragma once

#include <grpcpp/grpcpp.h>
#include "playout.grpc.pb.h"

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

namespace tvbraza {

class PlayoutServiceImpl final : public playout::PlayoutEngine::Service {
public:
    PlayoutServiceImpl();
    ~PlayoutServiceImpl() override;

    grpc::Status StartStream(grpc::ServerContext* context,
                             const playout::StreamRequest* request,
                             playout::StreamResponse* response) override;

    grpc::Status StopStream(grpc::ServerContext* context,
                            const playout::StopRequest* request,
                            playout::StreamResponse* response) override;

    grpc::Status SwitchSource(grpc::ServerContext* context,
                              const playout::SourceSwitchRequest* request,
                              playout::StreamResponse* response) override;

    grpc::Status TriggerStandby(grpc::ServerContext* context,
                               const playout::StandbyRequest* request,
                               playout::StreamResponse* response) override;

    grpc::Status SubscribeMetrics(grpc::ServerContext* context,
                                  const playout::MetricsRequest* request,
                                  grpc::ServerWriter<playout::StreamMetric>* writer) override;

    grpc::Status GetHealth(grpc::ServerContext* context,
                           const playout::HealthRequest* request,
                           playout::HealthResponse* response) override;

private:
    void PlayoutWorkerLoop();
    void TerminateActiveProcess();
    int64_t GetCurrentTimestampMs() const;
    int64_t GetMemoryRssKb() const;

    std::atomic<bool> running_{false};
    std::atomic<bool> is_standby_{true};
    std::string current_source_url_;
    std::string current_video_title_;
    std::string current_rtmp_url_;
    std::string current_stream_key_;
    int32_t start_position_{0};

    // Live Metrics
    std::atomic<int64_t> frame_count_{0};
    std::atomic<double> current_fps_{60.0};
    std::atomic<int32_t> current_bitrate_kbps_{4500};
    std::atomic<double> current_speed_{1.0};
    std::atomic<int64_t> dropped_frames_{0};
    std::chrono::steady_clock::time_point stream_start_time_;

    pid_t active_pid_{-1};
    mutable std::mutex state_mutex_;
    std::condition_variable cv_;
    std::unique_ptr<std::thread> worker_thread_;
};

} // namespace tvbraza
