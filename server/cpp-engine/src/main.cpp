#include "playout_service.h"

#include <grpcpp/grpcpp.h>
#include <csignal>
#include <iostream>
#include <memory>
#include <string>

static std::unique_ptr<grpc::Server> g_server = nullptr;

void SignalHandler(int signal) {
    std::cout << "\n[C++ Engine] Sinal " << signal << " recebido. Finalizando servidor gRPC..." << std::endl;
    if (g_server) {
        g_server->Shutdown();
    }
}

int main(int argc, char** argv) {
    std::string server_address("0.0.0.0:50051");
    if (argc > 1) {
        server_address = argv[1];
    }

    std::signal(SIGINT, SignalHandler);
    std::signal(SIGTERM, SignalHandler);

    tvbraza::PlayoutServiceImpl service;

    grpc::ServerBuilder builder;
    builder.AddListeningPort(server_address, grpc::InsecureServerCredentials());
    builder.RegisterService(&service);

    // Otimizações de canal gRPC para baixa latência
    builder.AddChannelArgument(GRPC_ARG_KEEPALIVE_TIME_MS, 10000);
    builder.AddChannelArgument(GRPC_ARG_KEEPALIVE_TIMEOUT_MS, 5000);
    builder.AddChannelArgument(GRPC_ARG_KEEPALIVE_PERMIT_WITHOUT_CALLS, 1);
    builder.AddChannelArgument(GRPC_ARG_MAX_RECEIVE_MESSAGE_LENGTH, 16 * 1024 * 1024);

    g_server = builder.BuildAndStart();
    std::cout << "====================================================\n";
    std::cout << " TV BRAZA - MOTOR NATIVO C++ PLAYOUT (gRPC CORE)\n";
    std::cout << "====================================================\n";
    std::cout << "[C++ Engine] Ouvindo em: " << server_address << std::endl;
    std::cout << "[C++ Engine] Protocolo: Protobuf v3 / gRPC Bidirecional\n";
    std::cout << "====================================================" << std::endl;

    g_server->Wait();
    std::cout << "[C++ Engine] Servidor gRPC finalizado com sucesso." << std::endl;
    return 0;
}
