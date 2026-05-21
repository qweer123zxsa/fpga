module decode_3_8(
    input wire A0,
    input wire A1,
    input wire A2,
    output reg Y0,
    output reg Y1,
    output reg Y2,
    output reg Y3,
    output reg Y4,
    output reg Y5,
    output reg Y6,
    output reg Y7
);

always @(*) begin
    case ({A2, A1, A0})
        3'b000: {Y7, Y6, Y5, Y4, Y3, Y2, Y1, Y0} = 8'b00000001;
        3'b001: {Y7, Y6, Y5, Y4, Y3, Y2, Y1, Y0} = 8'b00000010;
        3'b010: {Y7, Y6, Y5, Y4, Y3, Y2, Y1, Y0} = 8'b00000100;
        3'b011: {Y7, Y6, Y5, Y4, Y3, Y2, Y1, Y0} = 8'b00001000;
        3'b100: {Y7, Y6, Y5, Y4, Y3, Y2, Y1, Y0} = 8'b00010000;
        3'b101: {Y7, Y6, Y5, Y4, Y3, Y2, Y1, Y0} = 8'b00100000;
        3'b110: {Y7, Y6, Y5, Y4, Y3, Y2, Y1, Y0} = 8'b01000000;
        3'b111: {Y7, Y6, Y5, Y4, Y3, Y2, Y1, Y0} = 8'b10000000;
        default: {Y7, Y6, Y5, Y4, Y3, Y2, Y1, Y0} = 8'b00000000;
    endcase
end
    




    
endmodule








