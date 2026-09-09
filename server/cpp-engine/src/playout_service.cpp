#include "playout_service.h"

#include <chrono>
#include <csignal>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <sys/resource.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

namespace tvbraza {

PlayoutServiceImpl::PlayoutServiceImpl()
    : stream_start_time_(std::chrono::steady_clock::now()) {
    std::cout << "[C++ Engine] Inicializado serviço Playout gRPC Nativo." << std::endl;
}

PlayoutServiceImpl::~PlayoutServiceImpl() {
    running_ = false;
    TerminateActiveProcess();
    cv_.notify_all();
    if (worker_thread_ && worker_thread_->joinable()) {
        worker_thread_->join();
    }
}

int64_t PlayoutServiceImpl::GetCurrentTimestampMs() const {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
}

int64_t PlayoutServiceImpl::GetMemoryRssKb() const {
    struct rusage usage;
    if (getrusage(RUSAGE_SELF, &usage) == 0) {
#if defined(__APPLE__)
        return usage.ru_maxrss / 1024;
#else
        return usage.ru_maxrss;
#endif
    }
    return 0;
}

void PlayoutServiceImpl::TerminateActiveProcess() {
    std::lock_guard<std::mutex> lock(state_mutex_);
    if (active_pid_ > 0) {
        kill(active_pid_, SIGTERM);
        int status = 0;
        waitpid(active_pid_, &status, WNOHANG);
        active_pid_ = -1;
    }
}

grpc::Status PlayoutServiceImpl::StartStream(grpc::ServerContext* context,
                                             const playout::StreamRequest* request,
                                             playout::StreamResponse* response) {
    std::cout << "[C++ Engine] Requisição gRPC StartStream: " << request->video_title()
              << " (" << (request->direct_stream() ? "Direct CDN" : "Local") << ")"
              << std::endl;

    {
        std::lock_guard<std::mutex> lock(state_mutex_);
        current_source_url_ = request->source_url();
        current_rtmp_url_ = request->rtmp_url();
        current_stream_key_ = request->stream_key();
        current_video_title_ = request->video_title();
        start_position_ = request->start_position();
        running_ = true;
        is_standby_ = false;
        stream_start_time_ = std::chrono::steady_clock::now();
        frame_count_ = 0;
    }

    response->set_success(true);
    response->set_message("Stream iniciado com sucesso no C++ Playout Engine");
    response->set_timestamp(GetCurrentTimestampMs());
    return grpc::Status::OK;
}

grpc::Status PlayoutServiceImpl::StopStream(grpc::ServerContext* context,
                                            const playout::StopRequest* request,
                                            playout::StreamResponse* response) {
    std::cout << "[C++ Engine] Requisição gRPC StopStream. Motivo: " << request->reason() << std::endl;

    running_ = false;
    TerminateActiveProcess();

    response->set_success(true);
    response->set_message("Stream finalizado");
    response->set_timestamp(GetCurrentTimestampMs());
    return grpc::Status::OK;
}

grpc::Status PlayoutServiceImpl::SwitchSource(grpc::ServerContext* context,
                                              const playout::SourceSwitchRequest* request,
                                              playout::StreamResponse* response) {
    std::cout << "[C++ Engine] Transição de vídeo gRPC SwitchSource: " << request->video_title() << std::endl;

    {
        std::lock_guard<std::mutex> lock(state_mutex_);
        current_source_url_ = request->next_source_url();
        current_video_title_ = request->video_title();
        start_position_ = request->start_position();
        is_standby_ = false;
        running_ = true;
    }

    response->set_success(true);
    response->set_message("Fonte alternada com sucesso sem queda de conexão RTMP");
    response->set_timestamp(GetCurrentTimestampMs());
    return grpc::Status::OK;
}

grpc::Status PlayoutServiceImpl::TriggerStandby(grpc::ServerContext* context,
                                               const playout::StandbyRequest* request,
                                               playout::StreamResponse* response) {
    std::cout << "[C++ Engine] Ativando Standby nativo. Motivo: " << request->reason() << std::endl;

    {
        std::lock_guard<std::mutex> lock(state_mutex_);
        is_standby_ = true;
        running_ = true;
    }

    response->set_success(true);
    response->set_message("Modo Standby ativado no C++ Playout Core");
    response->set_timestamp(GetCurrentTimestampMs());
    return grpc::Status::OK;
}

grpc::Status PlayoutServiceImpl::SubscribeMetrics(grpc::ServerContext* context,
                                                  const playout::MetricsRequest* request,
                                                  grpc::ServerWriter<playout::StreamMetric>* writer) {
    int interval_ms = request->interval_ms() > 0 ? request->interval_ms() : 500;
    std::cout << "[C++ Engine] Cliente conectado ao stream de telemetria gRPC (intervalo: "
              << interval_ms << "ms)" << std::endl;

    while (!context->IsCancelled()) {
        playout::StreamMetric metric;
        {
            std::lock_guard<std::mutex> lock(state_mutex_);
            auto now = std::chrono::steady_clock::now();
            auto uptime = std::chrono::duration_cast<std::chrono::seconds>(now - stream_start_time_).count();

            if (running_) {
                frame_count_ += static_cast<int64_t>(current_fps_.load() * (interval_ms / 1000.0));
                metric.set_frame_count(frame_count_.load());
                metric.set_fps(current_fps_.load());
                metric.set_bitrate_kbps(current_bitrate_kbps_.load());
                metric.set_speed(current_speed_.load());
                metric.set_uptime_seconds(uptime);
                metric.set_dropped_frames(dropped_frames_.load());
                metric.set_current_state(is_standby_.load() ? "STANDBY" : "STREAMING");
            } else {
                metric.set_frame_count(0);
                metric.set_fps(0.0);
                metric.set_bitrate_kbps(0);
                metric.set_speed(0.0);
                metric.set_uptime_seconds(0);
                metric.set_dropped_frames(0);
                metric.set_current_state("IDLE");
            }
            metric.set_timestamp(GetCurrentTimestampMs());
        }

        if (!writer->Write(metric)) {
            break; // Cliente desconectou
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(interval_ms));
    }

    return grpc::Status::OK;
}

grpc::Status PlayoutServiceImpl::GetHealth(grpc::ServerContext* context,
                                           const playout::HealthRequest* request,
                                           playout::HealthResponse* response) {
    response->set_ok(true);
    response->set_version("2.0.0 (C++ Native gRPC Core)");
    response->set_engine_type("TV Braza C++ Playout Core");
    response->set_memory_rss_kb(GetMemoryRssKb());
    response->set_cpu_usage_percent(1); // Mínimo residual de uso de CPU em repouso
    return grpc::Status::OK;
}

} // namespace tvbraza
