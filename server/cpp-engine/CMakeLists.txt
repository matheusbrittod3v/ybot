cmake_minimum_required(VERSION 3.16)
project(tvbraza_engine CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# Dependências gRPC e Protobuf
find_package(Protobuf REQUIRED)
find_package(gRPC CONFIG REQUIRED)

message(STATUS "Usando Protobuf ${Protobuf_VERSION}")
message(STATUS "Usando gRPC ${gRPC_VERSION}")

set(PROTO_SRC_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../proto")
set(PROTO_FILE "${PROTO_SRC_DIR}/playout.proto")

# Geração de código C++ a partir do .proto
set(PROTO_HDRS "${CMAKE_CURRENT_BINARY_DIR}/playout.pb.h")
set(PROTO_SRCS "${CMAKE_CURRENT_BINARY_DIR}/playout.pb.cc")
set(GRPC_HDRS "${CMAKE_CURRENT_BINARY_DIR}/playout.grpc.pb.h")
set(GRPC_SRCS "${CMAKE_CURRENT_BINARY_DIR}/playout.grpc.pb.cc")

add_custom_command(
      OUTPUT "${PROTO_HDRS}" "${PROTO_SRCS}" "${GRPC_HDRS}" "${GRPC_SRCS}"
      COMMAND protobuf::protoc
      ARGS --grpc_out "${CMAKE_CURRENT_BINARY_DIR}"
           --cpp_out "${CMAKE_CURRENT_BINARY_DIR}"
           -I "${PROTO_SRC_DIR}"
           --plugin=protoc-gen-grpc=$<TARGET_FILE:gRPC::grpc_cpp_plugin>
           "${PROTO_FILE}"
      DEPENDS "${PROTO_FILE}"
)

include_directories(
    "${CMAKE_CURRENT_BINARY_DIR}"
    "${CMAKE_CURRENT_SOURCE_DIR}/src"
)

add_executable(tvbraza-engine
    src/main.cpp
    src/playout_service.cpp
    ${PROTO_SRCS}
    ${GRPC_SRCS}
)

target_link_libraries(tvbraza-engine
    PRIVATE
    gRPC::grpc++
    gRPC::grpc++_reflection
    protobuf::libprotobuf
    pthread
)

install(TARGETS tvbraza-engine DESTINATION /usr/local/bin)
